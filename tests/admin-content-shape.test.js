// Unit test for the admin.html <-> database.js content-shape boundary.
//
// database.js stores books flat with a `series_id` FK (see SelectBooks/
// GetAllContent in database.js) — series rows never carry a `.books` array.
// admin.html's editor UI predates that and still treats every series as
// owning a nested `books` array (renderBooksPanel/getBook/getBooks all index
// through `series[si].books`). nestBooksIntoSeries() and flattenSeriesBooks()
// in admin.html are the single boundary that translates between the two
// shapes on load/save respectively. Without them, the admin panel throws
// "Cannot read properties of undefined (reading 'length')" the instant any
// series exists (reproduced live against a running server before this fix),
// and any book living inside a series is silently dropped on save (since
// SaveAllContent only reads the top-level `books` array). This test extracts
// those two functions directly from admin.html — no DOM/server needed, they
// are pure data transforms — so a future edit that breaks the shape contract
// fails fast here instead of only in a live admin panel.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ADMIN_HTML = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');

function extractFunction(name) {
    // Matches "function NAME(...) { ... }" up to the matching top-level
    // brace close, by tracking brace depth char-by-char from the opening
    // "{" — regex alone can't balance nested braces reliably.
    const startMatch = ADMIN_HTML.match(new RegExp(`function ${name}\\([^)]*\\)\\s*\\{`));
    if (!startMatch) throw new Error(`Could not find function ${name} in admin.html`);
    const start = startMatch.index;
    let depth = 0;
    let i = ADMIN_HTML.indexOf('{', start);
    const bodyStart = i;
    for (; i < ADMIN_HTML.length; i++) {
        if (ADMIN_HTML[i] === '{') depth++;
        else if (ADMIN_HTML[i] === '}') {
            depth--;
            if (depth === 0) break;
        }
    }
    return ADMIN_HTML.slice(start, i + 1);
}

const context = {};
vm.createContext(context);
vm.runInContext(extractFunction('nestBooksIntoSeries'), context);
vm.runInContext(extractFunction('flattenSeriesBooks'), context);
const { nestBooksIntoSeries, flattenSeriesBooks } = context;

test('nestBooksIntoSeries nests flat DB-shaped books into their series and keeps standalone books at root', () => {
    const fromContentApi = {
        series: [{ id: 's1', name: 'Xanrean Chronicles', universe: 'Xanrean Chronicles' }],
        books: [
            { id: 'b1', title: 'Volume 2', series_id: 's1', volume_number: 2 },
            { id: 'b2', title: 'Volume 1', series_id: 's1', volume_number: 1 },
            { id: 'b3', title: 'Standalone Book', series_id: null },
        ],
    };

    const nested = nestBooksIntoSeries(fromContentApi);

    assert.strictEqual(nested.series[0].books.length, 2);
    // Sorted by volume_number, not insertion order.
    assert.deepStrictEqual(nested.series[0].books.map(b => b.id), ['b2', 'b1']);
    assert.strictEqual(nested.books.length, 1);
    assert.strictEqual(nested.books[0].id, 'b3');
});

test('flattenSeriesBooks flattens series[i].books back to a root array with seriesId set, without dropping them', () => {
    const editedInAdminUi = {
        books: [{ id: 'b3', title: 'Standalone Book' }],
        series: [{
            id: 's1',
            universe: 'Xanrean Chronicles',
            books: [
                { id: 'b2', title: 'Volume 1' },
                { id: 'b1', title: 'Volume 2' },
            ],
        }],
    };

    const flattened = flattenSeriesBooks(editedInAdminUi);

    assert.strictEqual(flattened.books.length, 3, 'standalone book plus both series books must be present');
    const b2 = flattened.books.find(b => b.id === 'b2');
    const b1 = flattened.books.find(b => b.id === 'b1');
    assert.strictEqual(b2.seriesId, 's1');
    assert.strictEqual(b1.seriesId, 's1');
    // Position within the series array becomes the persisted order.
    assert.strictEqual(b2.volumeNumber, 1);
    assert.strictEqual(b1.volumeNumber, 2);
});

test('nestBooksIntoSeries -> flattenSeriesBooks round-trips without losing or duplicating books', () => {
    const fromContentApi = {
        series: [{ id: 's1', name: 'Xanrean Chronicles', universe: 'Xanrean Chronicles' }],
        books: [
            { id: 'b1', title: 'Volume 1', series_id: 's1', volume_number: 1 },
            { id: 'b2', title: 'Volume 2', series_id: 's1', volume_number: 2 },
            { id: 'b3', title: 'Standalone Book', series_id: null },
        ],
    };

    const roundTripped = flattenSeriesBooks(nestBooksIntoSeries(fromContentApi));

    assert.strictEqual(roundTripped.books.length, 3);
    // Arrays created inside the vm context compare oddly with deepStrictEqual,
    // so compare a primitive string instead.
    assert.strictEqual(roundTripped.books.map(b => b.id).sort().join(','), 'b1,b2,b3');
});
