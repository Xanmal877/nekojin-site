// Optional .docx manuscript reading. Off unless MANUSCRIPTS_ENABLED=true: with
// the flag off the read endpoints stay unmapped and only the upload route
// answers, with a 503 explaining how to turn the feature on.
//
// The manuscripts directory and the docx converter are injected, because the
// converter is only required when the feature is on and the directory belongs
// to the server.

const fs = require('fs');
const path = require('path');
const { sendJson, sendText, notFound, readMultipartFile, safePathSegment } = require('./http-helpers');

let MANUSCRIPTS_DIR;
let mammoth;
function configure(options) {
    MANUSCRIPTS_DIR = options.manuscriptsDir;
    mammoth = options.mammoth;
}

// ── MANUSCRIPTS (disabled by default) ─────────────────────
// Reading .docx manuscripts is a whole optional feature, so it lives in one
// function instead of being sprinkled through the request dispatch chain.
// With MANUSCRIPTS_ENABLED=false (the default) the read endpoints stay
// unmapped and only /upload-manuscript answers, with a 503 explaining how to
// turn the feature on.
async function handleManuscriptRequest(req, res, url) {
    if (req.method === 'GET' && url === '/api/manuscripts') {
        return sendJson(res, { manuscripts: listManuscripts() });
    }

    const chaptersMatch = url.match(/^\/api\/manuscripts\/([^\/]+)\/chapters$/);
    if (req.method === 'GET' && chaptersMatch) {
        const slug = chaptersMatch[1];
        const chapters = await parseManuscript(slug);
        if (!chapters) return notFound(res);
        return sendJson(res, {
            slug,
            total: chapters.length,
            preview: chapters.length > 3 ? 3 : chapters.length,
            chapters: chapters.map((c, i) => ({ num: c.num, title: c.title, index: i }))
        });
    }

    const chapterMatch = url.match(/^\/api\/manuscripts\/([^\/]+)\/chapters\/([0-9]+)$/);
    if (req.method === 'GET' && chapterMatch) {
        const chapters = await parseManuscript(chapterMatch[1]);
        if (!chapters) return notFound(res);
        const chapter = chapters.find(c => c.num === parseInt(chapterMatch[2], 10));
        if (!chapter) return sendText(res, 'Chapter not found', 404);
        return sendJson(res, {
            num: chapter.num,
            title: chapter.title,
            content: chapter.content,
            total: chapters.length
        });
    }
}

async function handleManuscriptUpload(req, res) {
    try {
        const upload = await readMultipartFile(req, 'file');
        if (upload.error) return sendText(res, upload.error, upload.status);
        const { parts, file } = upload;
        if (!/\.docx$/i.test(file.filename || '')) return sendText(res, 'Only .docx files supported', 400);
        const formSlug = (parts['slug'] || '').trim();
        const slug = formSlug
            ? safePathSegment(formSlug)
            : safePathSegment((file.filename || '').replace(/\.docx$/i, ''), 'manuscript');
        fs.writeFileSync(path.join(MANUSCRIPTS_DIR, slug + '.docx'), file.data);
        MANUSCRIPT_CACHE.delete(slug);
        return sendJson(res, { slug, name: slug + '.docx', size: file.data.length });
    } catch (e) {
        return sendText(res, e.message, 500);
    }
}

const MANUSCRIPT_DISABLED = {
    error: 'Manuscript upload disabled (Option 1). Set MANUSCRIPTS_ENABLED=true to re-enable.'
};

// ── MANUSCRIPT PARSING (.docx → chapters) ──────────────────
const MANUSCRIPT_CACHE = new Map();

async function parseManuscript(slug) {
    const filePath = path.join(MANUSCRIPTS_DIR, slug + '.docx');
    if (!fs.existsSync(filePath)) return null;
    const mtime = fs.statSync(filePath).mtimeMs;
    const cached = MANUSCRIPT_CACHE.get(slug);
    if (cached && cached.mtime === mtime) return cached.chapters;

    const result = await mammoth.convertToHtml({ path: filePath }, {
        styleMap: [
            "p[style-name='Heading 1'] => h1",
            "p[style-name='Heading 2'] => h2",
            "p[style-name='Heading 3'] => h3",
            "p[style-name='Title'] => h1.title",
        ]
    });
    const chapters = splitHtmlIntoChapters(result.value);
    MANUSCRIPT_CACHE.set(slug, { mtime, chapters });
    return chapters;
}

function splitHtmlIntoChapters(html) {
    const chapterRegex = /<(h1|h2|h3)[^>]*>(.*?)<\/\1>/gi;
    const chapters = [];
    let lastIndex = 0;
    let match;
    let chapterNum = 0;

    while ((match = chapterRegex.exec(html)) !== null) {
        const headingText = match[2].replace(/<[^>]+>/g, '').trim();
        const textBefore = html.slice(lastIndex, match.index).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
        const isFirst = chapters.length === 0;
        const isChapterHeading = /chapter|prologue|epilogue|preface|introduction|part\s+\d+/i.test(headingText);

        if (!isChapterHeading && isFirst && textBefore.length < 200) {
            lastIndex = match.index + match[0].length;
            continue;
        }

        if (chapters.length > 0) {
            chapters[chapters.length - 1].content = html.slice(lastIndex, match.index);
        }
        chapterNum++;
        chapters.push({ num: chapterNum, title: headingText, content: '' });
        lastIndex = match.index + match[0].length;
    }

    if (chapters.length > 0) {
        chapters[chapters.length - 1].content = html.slice(lastIndex);
    }

    if (chapters.length === 0) {
        chapters.push({ num: 1, title: 'Chapter 1', content: html });
    }
    return chapters;
}

function listManuscripts() {
    try {
        return fs.readdirSync(MANUSCRIPTS_DIR)
            .filter(f => f.endsWith('.docx') || f.endsWith('.epub'))
            .map(f => f.replace(/\.(docx|epub)$/i, ''));
    } catch { return []; }
}

module.exports = {
    configure,
    MANUSCRIPT_DISABLED, handleManuscriptRequest, handleManuscriptUpload,
    listManuscripts
};
