import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
const { findOperationVisual } = await import('../dist/src/utils/OperationVisual.js');

function withDir(files, fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-'));
    try {
        for (const name of files) fs.writeFileSync(path.join(dir, name), 'x');
        fn(dir);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

test('un png est trouvé', () => withDir(['Minage.png'], dir => {
    assert.equal(findOperationVisual(dir, 'Minage'), path.join(dir, 'Minage.png'));
}));

test('un jpg est trouvé quand il n\'y a pas de png', () => withDir(['Minage.jpg'], dir => {
    assert.equal(findOperationVisual(dir, 'Minage'), path.join(dir, 'Minage.jpg'));
}));

test('un jpeg et une extension en majuscules sont acceptés', () => withDir(['A.jpeg', 'B.JPG'], dir => {
    assert.equal(findOperationVisual(dir, 'A'), path.join(dir, 'A.jpeg'));
    assert.equal(findOperationVisual(dir, 'B'), path.join(dir, 'B.JPG'));
}));

test('le png reste prioritaire sur le jpg', () => withDir(['Minage.jpg', 'Minage.png'], dir => {
    assert.equal(findOperationVisual(dir, 'Minage'), path.join(dir, 'Minage.png'));
}));

test('aucun visuel, autre format ou dossier absent : null', () => withDir(['Minage.gif', 'Minage.png.bak'], dir => {
    assert.equal(findOperationVisual(dir, 'Minage'), null);
    assert.equal(findOperationVisual(path.join(dir, 'absent'), 'Minage'), null);
}));
