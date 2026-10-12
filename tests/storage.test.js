'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { createEnv, mask, rawMasks, SPLIT_KEY, STORAGE_LIMIT } = require('./helpers/env');

let env;
afterEach(() => env && env.close());

async function setup(masks, options = {}, envOpts = {}) {
  const storage = masks === undefined ? {} : { maskListUser: typeof masks === 'string' ? masks : rawMasks(masks) };
  env = createEnv(Object.assign({ storage }, envOpts));
  await env.addMask(options);
  return env;
}

const baseLength = JSON.stringify(mask('')).length;
const maskOfEncodedLength = len => mask('a'.repeat(len - baseLength));

describe('чтение списка масок', () => {
  it('пустое хранилище (ошибка 404) — это пустой список, а не сбой', async () => {
    await setup();
    assert.equal(env.data.storage.count, 0);
    assert.equal(env.data.storage.lastRead.ok, true);
    assert.equal(env.logs.error.length, 0);
  });

  it('читает сохранённые маски по порядку', async () => {
    await setup([mask('a'), mask('b'), mask('c')]);
    assert.equal(env.data.storage.count, 3);
  });

  it('пустая строка и лишние разделители дают пустой список', async () => {
    await setup(`${SPLIT_KEY}${SPLIT_KEY}`);
    assert.equal(env.data.storage.count, 0);
    assert.equal(env.data.storage.lastRead.ok, true);
  });

  it('повреждённые записи отбрасываются, остальные читаются', async () => {
    await setup(rawMasks([mask('a'), '{битый json', mask('b')]));
    assert.equal(env.data.storage.count, 2);
    assert.equal(env.data.storage.lastRead.dropped, 1);
    assert.ok(env.logs.error.some(args => String(args[0]).includes('Маска неверно сохранилась')));
  });

  it('заменяет старый хостинг forumupload.ru на upforme.ru', async () => {
    await setup([{ avatar: { tag: 'icon', value: 'https://forumupload.ru/uploads/1.png' } }]);
    const report = env.report({ remote: false });
    assert.equal(report.storage.count, 1);
    const exported = JSON.parse(env.data.export());
    assert.equal(exported.masks[0].avatar.value, 'https://upforme.ru/uploads/1.png');
  });

  it('строка с некорректным %-кодированием читается без декодирования', async () => {
    const m = JSON.stringify(mask('100% готово'));
    await setup(m);
    assert.equal(env.data.storage.count, 1);
  });

  it('ответ без данных и пустой ответ — ошибка чтения', async () => {
    for (const [response, reason] of [[null, 'empty-response'], [{ response: {} }, 'no-data']]) {
      env = createEnv();
      env.state.readResponse = response;
      await env.addMask({});
      assert.equal(env.data.storage.lastRead.ok, false);
      assert.equal(env.data.storage.lastRead.reason, reason);
      env.close();
    }
    env = null;
  });

  it('ошибка API (не 404) не стирает список и пишет в консоль', async () => {
    env = createEnv();
    env.state.readResponse = { error: { code: 500 } };
    await env.addMask({});
    assert.equal(env.data.storage.lastRead.reason, 'api-error');
    assert.equal(env.data.storage.lastRead.code, '500');
    assert.ok(env.logs.error.some(args => String(args[0]).includes('Не удалось загрузить список масок')));
  });

  it('таймаут запроса помечается отдельной причиной', async () => {
    env = createEnv();
    env.state.failRead = 'timeout';
    await env.addMask({});
    assert.equal(env.data.storage.lastRead.reason, 'timeout');
  });

  it('журнал ошибок хранится не больше 20 записей', async () => {
    await setup([mask('a')]);
    env.state.failRead = true;
    for (let i = 0; i < 25; i++) env.report({ remote: true });
    assert.equal(env.data.storage.errors.length, 20);
  });
});

describe('статистика хранилища', () => {
  it('считает объём, остаток и процент заполнения', async () => {
    await setup([mask('a')], { maskLimit: 5 });
    const s = env.data.storage;
    const len = JSON.stringify(mask('a')).length;
    assert.equal(s.limit, 5);
    assert.equal(s.byteLimit, STORAGE_LIMIT);
    assert.equal(s.encodedLength, len);
    assert.equal(s.free, STORAGE_LIMIT - 1 - len);
    assert.equal(s.usedPercent, Math.round(len / STORAGE_LIMIT * 1000) / 10);
  });

  it('пустой список: нулевой объём', async () => {
    await setup();
    assert.equal(env.data.storage.encodedLength, 0);
    assert.equal(env.data.storage.usedPercent, 0);
  });

  it('служебные данные отдаются копией, а не ссылкой', async () => {
    await setup();
    env.data.storage.errors.push('мусор');
    assert.equal(env.data.storage.errors.length, 0);
  });
});

describe('экспорт', () => {
  it('выгружает формат hvss-masks версии 1', async () => {
    await setup([mask('a'), mask('b')]);
    const parsed = JSON.parse(env.data.export());
    assert.equal(parsed.format, 'hvss-masks');
    assert.equal(parsed.version, 1);
    assert.equal(parsed.source, 'server');
    assert.equal(parsed.userId, 3);
    assert.deepEqual(parsed.masks, [mask('a'), mask('b')]);
    assert.ok(!Number.isNaN(Date.parse(parsed.exportedAt)));
  });

  it('при недоступном сервере выгружает кэш страницы и предупреждает', async () => {
    await setup([mask('a')]);
    env.state.failRead = true;
    const parsed = JSON.parse(env.data.export());
    assert.equal(parsed.source, 'cache');
    assert.deepEqual(parsed.masks, [mask('a')]);
    assert.equal(env.logs.warn.length, 1);
  });

  it('пустой список выгружается как пустой массив', async () => {
    await setup();
    assert.deepEqual(JSON.parse(env.data.export()).masks, []);
  });

  it('результат экспорта можно импортировать обратно', async () => {
    await setup([mask('a'), mask('b')]);
    const text = env.data.export();
    const result = env.import(text, { mode: 'replace', confirm: true });
    assert.equal(result.ok, true);
    assert.deepEqual(env.storedMasks(), [mask('a'), mask('b')]);
  });
});

describe('импорт: разбор входных данных', () => {
  it('невалидный JSON', async () => {
    await setup();
    const r = env.import('{не json');
    assert.deepEqual([r.ok, r.applied, r.reason], [false, false, 'invalid-json']);
  });

  for (const [name, input] of [
    ['null', null],
    ['число', 5],
    ['строка-не-JSON-объект', '"привет"'],
    ['объект без format', { masks: [] }],
    ['чужой format', { format: 'other', masks: [] }],
    ['masks не массив', { format: 'hvss-masks', masks: {} }],
  ]) {
    it(`неверный формат: ${name}`, async () => {
      await setup();
      const r = env.import(input);
      assert.equal(r.ok, false);
      assert.equal(r.reason, 'bad-format');
    });
  }

  it('версия формата новее поддерживаемой', async () => {
    await setup();
    const r = env.import({ format: 'hvss-masks', version: 2, masks: [mask('a')] });
    assert.equal(r.reason, 'unsupported-version');
  });

  it('принимает и голый массив масок', async () => {
    await setup();
    const r = env.import([mask('a')]);
    assert.equal(r.ok, true);
    assert.deepEqual(env.storedMasks(), [mask('a')]);
  });

  it('пустой массив — нечего импортировать', async () => {
    await setup();
    assert.equal(env.import([]).reason, 'nothing-to-import');
  });
});

describe('импорт: проверка отдельных масок', () => {
  const rejects = {
    'не объект': ['строка', 'bad-shape'],
    'null': [null, 'bad-shape'],
    'массив': [[1, 2], 'bad-shape'],
    'пустая маска': [{}, 'empty-mask'],
    'поле без value': [{ author: { tag: 'nick' } }, 'bad-field:author'],
    'value — булево': [{ author: { tag: 'nick', value: true } }, 'bad-field:author'],
    'value — объект': [{ author: { tag: 'nick', value: {} } }, 'bad-field:author'],
    'value — null': [{ author: { tag: 'nick', value: null } }, 'bad-field:author'],
    'поле — строка': [{ author: 'Алиса' }, 'bad-field:author'],
    'поле — null': [{ author: null }, 'bad-field:author'],
    'опасный html': [{ author: { tag: 'nick', value: '<script>1</script>' } }, 'unsafe-html:author'],
    'обработчик события': [{ author: { tag: 'nick', value: '<b onclick="1">x</b>' } }, 'unsafe-html:author'],
    'разделитель списка в значении': [{ author: { tag: 'nick', value: `a${SPLIT_KEY}b` } }, 'split-key'],
  };

  for (const [name, [item, reason]] of Object.entries(rejects)) {
    it(`отклоняет: ${name}`, async () => {
      await setup([mask('старая')]);
      const r = env.import([item, mask('новая')]);
      assert.equal(r.ok, true);
      assert.deepEqual(r.rejected, [{ index: 0, reason }]);
      assert.equal(r.accepted, 1);
    });
  }

  it('отклоняет ключ __proto__', async () => {
    await setup();
    const payload = JSON.parse('[{"__proto__": {"tag": "x", "value": "y"}}]');
    const r = env.import(payload);
    assert.equal(r.reason, 'nothing-to-import');
    assert.equal(r.rejected[0].reason, 'bad-field:__proto__');
    assert.equal({}.tag, undefined);
  });

  it('если все маски плохие, список на сервере не меняется', async () => {
    await setup([mask('a')]);
    const before = env.state.storage.maskListUser;
    assert.equal(env.import([{}, null]).reason, 'nothing-to-import');
    assert.equal(env.state.storage.maskListUser, before);
  });

  it('число в value допустимо', async () => {
    await setup();
    const r = env.import([{ author: { tag: 'nick', value: 42 } }]);
    assert.equal(r.ok, true);
  });

  it('неизвестное поле принимается с предупреждением', async () => {
    await setup();
    const r = env.import([{ mood: { tag: 'mood', value: 'ok' } }]);
    assert.equal(r.ok, true);
    assert.deepEqual(r.warnings, [{ index: 0, key: 'mood', reason: 'unknown-field' }]);
  });

  it('лишние свойства поля сохраняются как есть', async () => {
    await setup();
    env.import([{ author: { tag: 'nick', value: 'x', extra: 1 } }]);
    assert.deepEqual(env.storedMasks(), [{ author: { tag: 'nick', value: 'x', extra: 1 } }]);
  });
});

describe('импорт: режимы и лимиты', () => {
  it('merge добавляет к существующим', async () => {
    await setup([mask('a')]);
    const r = env.import([mask('b')]);
    assert.deepEqual([r.before, r.after, r.mode], [1, 2, 'merge']);
    assert.deepEqual(env.storedMasks(), [mask('a'), mask('b')]);
  });

  it('merge переносит дубль в конец, а не размножает', async () => {
    await setup([mask('a'), mask('b')]);
    env.import([mask('a')]);
    assert.deepEqual(env.storedMasks(), [mask('b'), mask('a')]);
  });

  it('дубль внутри самого импорта схлопывается', async () => {
    await setup();
    env.import([mask('a'), mask('a')]);
    assert.equal(env.storedMasks().length, 1);
  });

  it('дубль определяется независимо от порядка ключей', async () => {
    const a = { author: { tag: 'nick', value: 'x' }, title: { tag: 'status', value: 'y' } };
    const b = { title: { tag: 'status', value: 'y' }, author: { tag: 'nick', value: 'x' } };
    await setup([a]);
    env.import([b]);
    assert.equal(env.storedMasks().length, 1);
  });

  it('replace без confirm не применяется', async () => {
    await setup([mask('a')]);
    const r = env.import([mask('b')], { mode: 'replace' });
    assert.deepEqual([r.ok, r.reason], [false, 'confirm-required']);
    assert.deepEqual(env.storedMasks(), [mask('a')]);
  });

  it('replace требует именно confirm: true', async () => {
    await setup([mask('a')]);
    for (const confirm of ['true', 1, 'yes']) {
      assert.equal(env.import([mask('b')], { mode: 'replace', confirm }).reason, 'confirm-required');
    }
  });

  it('replace с confirm заменяет список и отдаёт резервную копию', async () => {
    await setup([mask('a')]);
    const r = env.import([mask('b')], { mode: 'replace', confirm: true });
    assert.equal(r.applied, true);
    assert.deepEqual(env.storedMasks(), [mask('b')]);
    assert.deepEqual(JSON.parse(r.backup).masks, [mask('a')]);
  });

  it('неизвестный режим считается merge', async () => {
    await setup([mask('a')]);
    env.import([mask('b')], { mode: 'что-то' });
    assert.equal(env.storedMasks().length, 2);
  });

  it('dryRun ничего не пишет, даже для replace без confirm', async () => {
    await setup([mask('a')]);
    const writes = () => env.state.calls.filter(c => c.method === 'storage.set').length;
    const r = env.import([mask('b')], { mode: 'replace', dryRun: true });
    assert.deepEqual([r.ok, r.applied, r.after], [true, false, 1]);
    assert.equal(writes(), 0);
    assert.deepEqual(env.storedMasks(), [mask('a')]);
  });

  it('лишние маски сверх maskLimit отрезаются с начала', async () => {
    await setup([mask('1'), mask('2')], { maskLimit: 3 });
    const r = env.import([mask('3'), mask('4'), mask('5')]);
    assert.equal(r.trimmedByLimit, 2);
    assert.deepEqual(env.storedMasks(), [mask('3'), mask('4'), mask('5')]);
  });

  it('ровно maskLimit масок не обрезается', async () => {
    await setup([mask('1')], { maskLimit: 3 });
    const r = env.import([mask('2'), mask('3')]);
    assert.equal(r.trimmedByLimit, 0);
    assert.equal(env.storedMasks().length, 3);
  });

  it('по умолчанию лимит 20 масок', async () => {
    await setup();
    env.import(Array.from({ length: 25 }, (_, i) => mask(String(i))));
    const stored = env.storedMasks();
    assert.equal(stored.length, 20);
    assert.equal(stored[0].author.value, '5');
  });

  it('после успешного импорта статистика обновляется', async () => {
    await setup();
    env.import([mask('a')]);
    assert.equal(env.data.storage.count, 1);
  });
});

describe('импорт: сбои записи', () => {
  it('сервер недоступен для чтения — ничего не пишем', async () => {
    await setup([mask('a')]);
    env.state.failRead = true;
    const r = env.import([mask('b')]);
    assert.deepEqual([r.ok, r.reason, r.applied], [false, 'remote-unavailable', false]);
    assert.deepEqual(env.storedMasks(), [mask('a')]);
  });

  it('ошибка записи оставляет список и кэш нетронутыми', async () => {
    await setup([mask('a')]);
    env.state.failWrite = true;
    const r = env.import([mask('b')]);
    assert.deepEqual([r.ok, r.applied, r.reason], [false, false, 'request']);
    assert.deepEqual(env.storedMasks(), [mask('a')]);
    assert.equal(env.data.storage.count, 1);
    assert.equal(env.data.storage.lastWrite.ok, false);
  });

  it('таймаут записи', async () => {
    await setup();
    env.state.failWrite = 'timeout';
    assert.equal(env.import([mask('a')]).reason, 'timeout');
  });

  it('ответ API с ошибкой записи', async () => {
    await setup();
    env.state.writeResponse = { error: { code: 403 } };
    const r = env.import([mask('a')]);
    assert.equal(r.reason, 'api-error');
    assert.equal(env.data.storage.lastWrite.code, '403');
  });

  it('ответ API не "1" считается неудачей', async () => {
    await setup();
    env.state.writeResponse = { response: 0 };
    assert.equal(env.import([mask('a')]).reason, 'bad-response');
    env.state.writeResponse = null;
    assert.equal(env.import([mask('a')]).reason, 'bad-response');
  });

  it('ответ "1" строкой считается успехом', async () => {
    await setup();
    env.state.writeResponse = { response: '1' };
    assert.equal(env.import([mask('a')]).ok, true);
  });

  it('переполнение хранилища: запрос на запись даже не отправляется', async () => {
    await setup();
    const r = env.import([maskOfEncodedLength(STORAGE_LIMIT + 10)]);
    assert.deepEqual([r.ok, r.reason], [false, 'overflow']);
    assert.equal(env.state.calls.filter(c => c.method === 'storage.set').length, 0);
  });

  it('граница лимита: 65499 символов проходит, 65500 — нет', async () => {
    await setup();
    const okResult = env.import([maskOfEncodedLength(STORAGE_LIMIT - 1)]);
    assert.equal(okResult.ok, true);
    assert.equal(okResult.encodedLength, STORAGE_LIMIT - 1);

    env.close();
    await setup();
    const failResult = env.import([maskOfEncodedLength(STORAGE_LIMIT)]);
    assert.equal(failResult.reason, 'overflow');
  });
});

describe('кодирование эмоджи и спецсимволов', () => {
  const tricky = [
    '😀 эмоджи',
    '👨‍👩‍👧‍👦 семья',
    '100% готово',
    '%41 и %F0%9F%98%80 как текст',
    'a|b|splitKey',
    'кавычки " \' и \\ слэш',
    'перенос\nстроки',
    '𝒳 математический символ',
    '\u{10FFFF}',
  ].filter(v => !v.includes(SPLIT_KEY));

  for (const value of tricky) {
    it(`значение переживает запись и чтение: ${JSON.stringify(value)}`, async () => {
      await setup();
      assert.equal(env.import([mask(value)]).ok, true);
      const raw = env.state.storage.maskListUser;
      assert.ok(!/[\u{10000}-\u{10FFFF}]/u.test(raw), 'в хранилище не должно быть символов вне BMP');

      const second = createEnv({ storage: { maskListUser: raw } });
      await second.addMask({});
      const exported = JSON.parse(second.data.export());
      second.close();
      assert.equal(exported.masks[0].author.value, value);
    });
  }

  it('кодированный объём считается по закодированной строке', async () => {
    await setup();
    const r = env.import([mask('😀')]);
    const raw = env.state.storage.maskListUser;
    assert.equal(r.encodedLength, raw.length);
    assert.ok(raw.length > JSON.stringify(mask('😀')).length);
  });
});

describe('проверка целостности (report)', () => {
  const codes = report => report.integrity.issues.map(i => i.code);

  it('чистый список — ok без замечаний', async () => {
    await setup([mask('a'), mask('b')]);
    const report = env.report();
    assert.deepEqual(report.integrity, { ok: true, issues: [] });
    assert.equal(report.storage.count, 2);
    assert.equal(report.env.version, env.hv.version);
  });

  it('JSON-значения не-объекты помечаются как bad-shape', async () => {
    await setup(['[]', '"строка"', '5', 'null']);
    const report = env.report({ remote: false });
    assert.deepEqual(codes(report), ['bad-shape', 'bad-shape', 'bad-shape', 'bad-shape']);
    assert.equal(report.integrity.ok, false);
  });

  it('пустая маска — предупреждение, не ошибка', async () => {
    await setup(['{}']);
    const { integrity } = env.report({ remote: false });
    assert.deepEqual(codes({ integrity }), ['empty-mask']);
    assert.equal(integrity.ok, true);
  });

  it('поле без корректного value', async () => {
    await setup([{ author: { tag: 'nick' } }, { author: 'x' }, { author: null }]);
    const { integrity } = env.report({ remote: false });
    assert.deepEqual(codes({ integrity }), ['bad-field', 'bad-field', 'bad-field']);
    assert.equal(integrity.issues[0].key, 'author');
  });

  it('неизвестное поле и опасный html', async () => {
    await setup([{ mood: { tag: 'm', value: 'x' } }, mask('<iframe></iframe>')]);
    const { integrity } = env.report({ remote: false });
    assert.deepEqual(codes({ integrity }), ['unknown-field', 'unsafe-html']);
  });

  it('дубли находятся и указывают на оригинал', async () => {
    await setup([mask('a'), mask('b'), mask('a')]);
    const { integrity } = env.report({ remote: false });
    assert.deepEqual(integrity.issues, [{ level: 'warn', code: 'duplicate', message: 'Дубль маски', index: 2, duplicateOf: 0 }]);
  });

  it('превышение maskLimit', async () => {
    await setup([mask('a'), mask('b'), mask('c')], { maskLimit: 2 });
    assert.deepEqual(codes(env.report({ remote: false })), ['over-limit']);
  });

  it('заполнение выше 90% даёт предупреждение, 100% — ошибку', async () => {
    await setup([maskOfEncodedLength(Math.ceil(STORAGE_LIMIT * 0.9))]);
    let r = env.report({ remote: false });
    assert.deepEqual(codes(r), ['size-near-limit']);
    assert.equal(r.integrity.ok, true);

    env.close();
    await setup([maskOfEncodedLength(STORAGE_LIMIT)]);
    r = env.report({ remote: false });
    assert.deepEqual(codes(r), ['size-overflow']);
    assert.equal(r.integrity.ok, false);
  });

  it('чуть ниже 90% — без предупреждения', async () => {
    await setup([maskOfEncodedLength(Math.floor(STORAGE_LIMIT * 0.9) - 1)]);
    assert.deepEqual(codes(env.report({ remote: false })), []);
  });

  it('remote: false не обращается к серверу', async () => {
    await setup([mask('a')]);
    const before = env.state.calls.length;
    env.report({ remote: false });
    assert.equal(env.state.calls.length, before);
  });

  it('рассинхрон страницы и сервера', async () => {
    await setup([mask('a')]);
    env.state.storage.maskListUser = rawMasks([mask('a'), mask('b')]);
    const { integrity } = env.report();
    assert.deepEqual(integrity.issues.map(i => i.code), ['out-of-sync']);
    assert.deepEqual([integrity.issues[0].local, integrity.issues[0].remote], [1, 2]);
  });

  it('сервер недоступен — ошибка remote-unavailable с причиной', async () => {
    await setup([mask('a')]);
    env.state.failRead = 'timeout';
    const { integrity } = env.report();
    assert.equal(integrity.ok, false);
    assert.equal(integrity.issues[0].code, 'remote-unavailable');
    assert.equal(integrity.issues[0].reason, 'timeout');
  });

  it('повреждённые записи на сервере замечаются', async () => {
    await setup(rawMasks([mask('a'), '{битый']));
    const { integrity } = env.report();
    assert.deepEqual(integrity.issues.map(i => i.code), ['remote-invalid-entries']);
    assert.equal(integrity.issues[0].count, 1);
  });

  it('отчёт печатается в консоль валидным JSON', async () => {
    await setup([mask('a')]);
    env.report({ remote: false });
    assert.doesNotThrow(() => JSON.parse(env.logs.log.at(-1)[0]));
  });
});

describe('доступ к отладочным данным', () => {
  it('env отдаёт версию и признак ключа API', async () => {
    await setup();
    assert.equal(env.data.env.version, env.hv.version);
    assert.equal(env.data.env.hasApiTicket, true);
    assert.equal(env.data.env.userId, 3);
  });

  it('access: админ получает extended, гость без настроек — нет', async () => {
    await setup([], {}, { groupId: 1 });
    assert.equal(env.data.access.forumAccessLevel, 'extended');
    assert.equal(env.data.access.checkAccess, true);
    assert.equal(env.data.access.groupId, 1);
  });

  it('access: ошибки внутри проверок не роняют getter', async () => {
    await setup([], {}, { forum: { topic: undefined } });
    env.win.FORUM = undefined;
    assert.doesNotThrow(() => env.data.access);
    assert.match(String(env.data.access.checkAccess), /^error: /);
  });

  it('access: без хлебных крошек уровень не определён, но не падает', async () => {
    await setup([], {}, { forum: { topic: undefined } });
    env.win.document.getElementById('pun-crumbs1').remove();
    assert.doesNotThrow(() => env.data.access.forumAccessLevel);
  });

  it('access: уровень по хлебным крошкам и спискам форума', async () => {
    await setup([], { forumAccess: { 'Игровая': ['Игрок'] } });
    assert.equal(env.data.access.forumAccessLevel, 'common');
    env.close();
    await setup([], { forumAccess: { 'Игровая': ['Игрок'] }, forumAccessExtended: { 'Игровая': ['Игрок'] } });
    assert.equal(env.data.access.forumAccessLevel, 'extended');
    env.close();
    await setup([], { forumAccess: { 'Игровая': ['Другие'] } });
    assert.equal(env.data.access.forumAccessLevel, null);
  });

  it('гостю без forumAccess уровень не выдаётся', async () => {
    await setup([], {}, { groupId: 3 });
    assert.equal(env.data.access.forumAccessLevel, null);
  });
});
