#!/usr/bin/env python3
"""
Sync book metadata + cover art from the KDP (Amazon) product pages into the
live site's database.

Why: the shop listings on Amazon are the source of truth for title, blurb,
ASIN and cover art. Hand-copying that into the admin panel drifts. This pulls
it straight off the product pages instead.

Usage
-----
    python3 tools/sync-kdp-books.py --dry        # report, write nothing
    python3 tools/sync-kdp-books.py             # fetch + update DB + covers

Requires Node.js on PATH (the DB write reuses database.js so the schema,
field mapping and operation queue stay identical to the admin panel).

Edit CATALOG below whenever a new volume goes live on KDP: add its ASIN and the
book slug it should attach to. That is the only maintenance this needs.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from html import unescape

SITE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COVERS_DIR = os.path.join(SITE_ROOT, "public", "covers")
DB_MODULE = os.path.join(SITE_ROOT, "database.js")

UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/140.0 Safari/537.36")

# ---------------------------------------------------------------- catalog ----
# series_slug is the `series.id` these volumes belong to. Omnibus/standalone
# entries have series_slug = None.
CATALOG = [
    # Her Majesty, Tamaneko — one KDP ebook per volume
    {"slug": "third-person-tempest", "series": "her-majesty-tamaneko", "volume": 1, "asin": "B0F4RG6P86"},
    {"slug": "vulpine-mastermind",   "series": "her-majesty-tamaneko", "volume": 2, "asin": "B0FG3D9M47"},
    {"slug": "water-spirits-sin",    "series": "her-majesty-tamaneko", "volume": 3, "asin": "B0G634SWGC"},
    {"slug": "the-guardian",         "series": "her-majesty-tamaneko", "volume": 4, "asin": "B0H9BH2DSM"},
    {"slug": "to-rule-a-kingdom",    "series": "her-majesty-tamaneko", "volume": 5, "asin": "B0HFYSB1G4"},
    {"slug": "fuyu-the-hero",        "series": "her-majesty-tamaneko", "volume": 6, "asin": "B0GX7MZWY5"},
    {"slug": "war-on-the-horizon",   "series": "her-majesty-tamaneko", "volume": 7, "asin": "B0HKKBN52M"},
    # The Bedrock — separate series. Volume 1 is titled "The Foundation" on KDP,
    # which is why the slug is not simply "the-bedrock".
    {"slug": "the-foundation",       "series": "the-bedrock", "volume": 1, "asin": "B0HJNF82P8"},
    # The Godling and Her Husband — its own series, not an HMT volume.
    {"slug": "the-godling-and-her-husband", "series": "the-godling-and-her-husband", "volume": 1, "asin": "B0HGCV9WFL"},
    # Omnibus — currently the Volumes 1-5 collection. Point this at a new ASIN
    # when the collection is reissued.
    {"slug": "her-majesty-tamaneko", "series": None, "volume": None, "asin": "B0GX2TMKHG"},
    # Standalone novellas
    {"slug": "lucas-the-grand-strategist", "series": None, "volume": None, "asin": "B0GX2WYVZQ"},
    {"slug": "the-hero-is-perfect",        "series": None, "volume": None, "asin": "B0GBV1TGJ5"},
]


# ---------------------------------------------------------------- fetching ---
def fetch(url: str, referer: str | None = None) -> bytes:
    cmd = ["curl", "-s", "--compressed", "-L", "-m", "45", "-A", UA,
           "-H", "Accept-Language: en-US,en;q=0.9"]
    if referer:
        cmd += ["-e", referer]
    cmd.append(url)
    out = subprocess.run(cmd, capture_output=True)
    if out.returncode != 0:
        raise RuntimeError(f"curl failed for {url}: {out.stderr.decode()[:200]}")
    return out.stdout


def _clean(fragment: str) -> str:
    fragment = re.sub(r"<script.*?</script>", " ", fragment or "", flags=re.S)
    fragment = re.sub(r"<style.*?</style>", " ", fragment, flags=re.S)
    text = unescape(re.sub(r"<[^>]+>", " ", fragment))
    text = re.sub(r"\s+", " ", text).strip()
    return re.sub(r"\s+([.,;:!?])", r"\1", text)  # "true ." -> "true."


def parse_product(html_bytes: bytes) -> dict:
    s = html_bytes.decode("utf-8", "ignore")

    def one(pat, flags=re.S):
        m = re.search(pat, s, flags)
        return m.group(1) if m else None

    title = _clean(one(r'id="productTitle"[^>]*>(.*?)</span>') or "") or None
    if not title:
        raise RuntimeError("product title not found — page layout changed or blocked")

    # Description block, stripped of Amazon's expand/collapse chrome.
    desc = ""
    m = re.search(r'id="bookDescription_feature_div"(.*?)(?:id="productDetails|id="detailBullets'
                  r'|id="bookDetails|id="reviewsMedley|id="customerReviews|</body)', s, re.S)
    if m:
        block = m.group(1)
        marker = 'in-initial-active-row="false">'
        i = block.find(marker)
        if i != -1:
            block = block[i + len(marker):]
        desc = _clean(block)
        for stop in ("Report an issue with this product", "Read more", "See more",
                     "Kindle Store", "About the author", "Print length",
                     "Publication date", "Language ‏"):
            j = desc.find(stop)
            if j > 120:
                desc = desc[:j]
        desc = desc.strip()

    # Highest-resolution cover Amazon serves, reduced to its stable image id.
    image_id = None
    m = re.search(r'data-a-dynamic-image=[\'"](.*?)[\'"]', s, re.S)
    if m:
        try:
            variants = json.loads(unescape(m.group(1)))
        except Exception:
            variants = {}
        if variants:
            def px(u):
                mm = re.search(r"_\._S[XY](\d+)_", u)
                return int(mm.group(1)) if mm else 0
            best = max(variants.keys(), key=px)
            mm = re.search(r"/images/I/([^./]+)\.", best)
            image_id = mm.group(1) if mm else None

    return {"title": title, "description": desc, "image_id": image_id}


def teaser(description: str) -> str:
    """Short card blurb: the first sentence or two of the KDP description."""
    if not description:
        return ""
    out: list[str] = []
    for part in re.split(r"(?<=[.!?])\s+", description):
        out.append(part)
        if len(" ".join(out)) >= 110 or len(out) >= 2:
            break
    return " ".join(out).strip()[:240]


def fetch_cover(image_id: str, dest: str) -> bool:
    url = f"https://m.media-amazon.com/images/I/{image_id}._SL1600_.jpg"
    data = fetch(url, referer="https://www.amazon.com/")
    if len(data) < 20000:
        return False
    with open(dest, "wb") as fh:
        fh.write(data)
    return True


# ------------------------------------------------------------------ writing --
NODE_UPDATE = r"""
const fs = require('node:fs');
const path = require('node:path');
const contentDB = require(process.env.NEKOJIN_DB_MODULE);
const payload = JSON.parse(fs.readFileSync(process.env.NEKOJIN_PAYLOAD, 'utf8'));
const coversDir = process.env.NEKOJIN_COVERS;
const dry = process.env.NEKOJIN_DRY === '1';

(async () => {
    await contentDB.Open();
    const existing = await contentDB.SelectBooks();
    const byId = new Map(existing.map(b => [b.id, b]));
    const ops = [];

    for (const item of payload.items) {
        const prev = byId.get(item.slug);
        const coverRel = `/covers/book-${item.slug}.webp`;
        if (!fs.existsSync(path.join(coversDir, `book-${item.slug}.webp`))) {
            throw new Error(`cover missing on disk: book-${item.slug}.webp`);
        }
        const platforms = [];
        const gum = (prev?.platforms || []).find(p => p.platform_type === 'gumroad' && p.url);
        if (gum) platforms.push({ type: 'gumroad', name: 'Gumroad', url: gum.url });
        platforms.push({ type: 'kdp', name: 'Kindle', url: item.kdp_url });

        const book = {
            id: item.slug,
            title: item.title,
            slug: item.slug,
            seriesId: item.series || null,
            volume: item.volume ? `Volume ${item.volume}` : (prev?.volume || ''),
            volumeNumber: item.volume || null,
            status: prev?.status || 'published',
            visible: prev?.visible !== false,
            cover: coverRel,
            blurb: item.blurb,
            description: item.description,
            genres: prev?.genres?.length ? prev.genres : [],
            tags: prev?.tags || [],
            tier: prev?.tier || null,
            ctaPlatform: 'kdp',
            wordCount: prev?.word_count || 0,
            publishAt: prev?.publish_at || null,
            platforms,
        };
        ops.push({ id: item.slug, action: prev ? 'update' : 'insert', book, prev });
        console.log(`[${prev ? 'update' : 'insert'}] ${item.slug} -> "${item.title}" ${book.volume}  cover=${coverRel}`);
    }

    if (dry) { console.log('\n--dry: no changes written.'); return; }

    const ok = await contentDB.CreateBackup('kdp-sync');
    if (!ok) throw new Error('backup failed; aborting');
    console.log('✅ restore point created');

    for (const op of ops) {
        await contentDB.DeleteBookPlatforms(op.id);
        await contentDB.InsertBook(op.book);
    }
    const after = await contentDB.SelectBooks();
    console.log(`\nDone. ${after.length} books in DB.`);
    process.exit(0);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
"""


def convert_cover(src_jpg: str, slug: str) -> str:
    """Run sharp on the Pi box so cover output matches /upload-cover exactly."""
    out = os.path.join(COVERS_DIR, f"book-{slug}.webp")
    script = (
        "const sharp=require(process.env.NEKOJIN_SHARP);"
        "(async()=>{const m=await sharp(process.env.NEKOJIN_SRC).metadata();"
        "let p=sharp(process.env.NEKOJIN_SRC);"
        "if(m.width>1200||m.height>1200)"
        "p=p.resize(1200,1200,{fit:'inside',withoutEnlargement:true});"
        "await p.webp({quality:85,effort:4}).toFile(process.env.NEKOJIN_OUT);"
        "const d=await sharp(process.env.NEKOJIN_OUT).metadata();"
        "console.log(d.width+'x'+d.height);})()"
    )
    env = dict(os.environ,
               NEKOJIN_SHARP=os.path.join(SITE_ROOT, "node_modules", "sharp"),
               NEKOJIN_SRC=src_jpg, NEKOJIN_OUT=out)
    r = subprocess.run(["node", "-e", script], capture_output=True, env=env, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"cover conversion failed for {slug}: {r.stderr[:300]}")
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true", help="report only, write nothing")
    ap.add_argument("--only", help="comma-separated slugs to limit the run")
    ap.add_argument("--skip-covers", action="store_true")
    args = ap.parse_args()

    items = CATALOG
    if args.only:
        wanted = {s.strip() for s in args.only.split(",")}
        items = [i for i in CATALOG if i["slug"] in wanted]
        missing = wanted - {i["slug"] for i in items}
        if missing:
            print(f"unknown slug(s): {', '.join(sorted(missing))}", file=sys.stderr)
            return 2

    work = tempfile.mkdtemp(prefix="kdp-sync-")
    payload_items = []

    for item in items:
        url = f"https://www.amazon.com/dp/{item['asin']}"
        print(f"→ {item['slug']}  ({item['asin']})")
        try:
            product = parse_product(fetch(url))
        except Exception as exc:
            print(f"   !! {exc}", file=sys.stderr)
            return 1

        print(f"   title: {product['title']}")
        print(f"   desc:  {len(product['description'])} chars")

        if not args.skip_covers and product["image_id"]:
            jpg = os.path.join(work, f"{item['slug']}.jpg")
            if fetch_cover(product["image_id"], jpg):
                webp = convert_cover(jpg, item["slug"])
                size = os.path.getsize(webp)
                print(f"   cover: {os.path.basename(webp)} ({size} bytes, image {product['image_id']})")
            else:
                print("   !! cover download failed; keeping existing art", file=sys.stderr)

        payload_items.append({
            "slug": item["slug"],
            "series": item["series"],
            "volume": item["volume"],
            "title": re.sub(r"\s*\([^)]*\)\s*$", "", product["title"]).strip(),
            "kdp_url": url,
            "asin": item["asin"],
            "description": product["description"],
            "blurb": teaser(product["description"]),
        })

    if not payload_items:
        print("nothing to do", file=sys.stderr)
        return 2

    payload_path = os.path.join(work, "payload.json")
    with open(payload_path, "w") as fh:
        json.dump({"items": payload_items}, fh)
    node_path = os.path.join(work, "update.js")
    with open(node_path, "w") as fh:
        fh.write(NODE_UPDATE)

    env = dict(os.environ,
               NEKOJIN_DB_MODULE=DB_MODULE,
               NEKOJIN_PAYLOAD=payload_path,
               NEKOJIN_COVERS=COVERS_DIR,
               NEKOJIN_DRY="1" if args.dry else "0")
    r = subprocess.run(["node", node_path], env=env, text=True)
    if r.returncode != 0:
        return r.returncode

    if not args.dry:
        meta = subprocess.run(["npm", "run", "meta"], cwd=SITE_ROOT,
                              capture_output=True, text=True)
        if meta.returncode == 0:
            print("sitemap.xml / rss.xml / robots.txt regenerated")
        else:
            print("warning: npm run meta failed", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
