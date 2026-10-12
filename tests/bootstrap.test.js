'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: sleep } = require('node:timers/promises');
const { createEnv, admin } = require('./helpers/env');

let env;
afterEach(() => env && env.close());

const settingsScripts = win => win.document.querySelectorAll('script[src*="45711.js"]');

describe('подгрузка формы настроек маски (HvScriptManager)', () => {
  it('без менеджера ничего не подключает', () => {
    env = createEnv();
    assert.equal(settingsScripts(env.win).length, 0);
  });

  it('с менеджером подключает скрипт настроек один раз', () => {
    env = createEnv({ beforeEval: win => { win.HvScriptManager = { list: () => [] }; } });
    const scripts = settingsScripts(env.win);
    assert.equal(scripts.length, 1);
    assert.equal(scripts[0].src, 'https://forumstatic.ru/files/0017/95/29/45711.js');
    assert.equal(scripts[0].async, true);
    assert.equal(scripts[0].parentNode, env.win.document.head);
  });

  it('не подключает, если форма profile-mask уже зарегистрирована', () => {
    env = createEnv({ beforeEval: win => { win.HvScriptManager = { list: () => [{ id: 'other' }, { id: 'profile-mask' }] }; } });
    assert.equal(settingsScripts(env.win).length, 0);
  });

  it('не подключает, если скрипт уже есть на странице', () => {
    env = createEnv({
      html: '<!doctype html><html><head><script src="https://x.example/45711.js"></script></head><body></body></html>',
      beforeEval: win => { win.HvScriptManager = { list: () => [] }; },
    });
    assert.equal(settingsScripts(env.win).length, 1);
  });

  it('в списке форм попадаются null и без id — не падает', () => {
    env = createEnv({ beforeEval: win => { win.HvScriptManager = { list: () => [null, undefined, {}] }; } });
    assert.equal(settingsScripts(env.win).length, 1);
  });

  it('менеджер без list() — подключает скрипт', () => {
    env = createEnv({ beforeEval: win => { win.HvScriptManager = {}; } });
    assert.equal(settingsScripts(env.win).length, 1);
  });

  it('list() бросает исключение — подключает скрипт', () => {
    env = createEnv({ beforeEval: win => { win.HvScriptManager = { list() { throw new Error('boom'); } }; } });
    assert.equal(settingsScripts(env.win).length, 1);
  });

  it('менеджер появился позже — скрипт подключается по таймеру, один раз', async () => {
    env = createEnv();
    assert.equal(settingsScripts(env.win).length, 0);
    env.win.HvScriptManager = { list: () => [] };
    await sleep(350);
    assert.equal(settingsScripts(env.win).length, 1);
  });

  it('менеджер появился позже, но форма уже есть — скрипт не добавляется', async () => {
    env = createEnv();
    env.win.HvScriptManager = { list: () => [{ id: 'profile-mask' }] };
    await sleep(250);
    assert.equal(settingsScripts(env.win).length, 0);
  });
});

describe('addMask без переданных настроек', () => {
  const settings = { changeList: { about: { title: 'О себе', tag: 'about', class: 'pa-fld1', type: 'text' } } };

  it('нет ответа сервера — ошибка в консоль и выход', async () => {
    env = createEnv({ forum: {} });
    env.state.settingsResponse = { response: null };
    await env.addMask();
    assert.ok(env.logs.error.some(args => String(args[0]).includes('Настройки скрипта маски не определены')));
    assert.equal(env.hv.data.changeList, undefined);
  });

  for (const [name, response] of [
    ['хранилище без data', { response: { storage: {} } }],
    ['хранилище не содержит ключ', { response: { storage: { data: {} } } }],
    ['пустая строка настроек', { response: { storage: { data: { profileMaskSettings: '' } } } }],
    ['битый JSON настроек', { response: { storage: { data: { profileMaskSettings: '{oops' } } } }],
  ]) {
    it(`${name} — настройки не определены`, async () => {
      env = createEnv({ forum: {} });
      env.state.settingsResponse = response;
      await env.addMask();
      assert.ok(env.logs.error.some(args => String(args[0]).includes('Настройки скрипта маски не определены')));
    });
  }

  it('валидные настройки применяются и скрипт сам инициализируется', async () => {
    env = createEnv({ forum: {}, groupId: 1 });
    env.state.settingsResponse = { response: { storage: { data: { profileMaskSettings: JSON.stringify(settings) } } } };
    env.win.document.getElementById('pun-main').innerHTML = '';
    await env.addMask();
    assert.ok(env.hv.data.changeList.about);
    assert.ok(env.hv.data.changeList.author, 'встроенные поля остаются');
    assert.equal(env.hv.inited, true);
    // настройки, полученные с сервера, обратно не сохраняются
    assert.equal(env.state.posts.length, 0);
  });

  it('настройки могут переопределять встроенные поля', async () => {
    env = createEnv({ forum: {} });
    await env.addMask({ changeList: { author: { title: 'Имя', tag: 'name', class: 'pa-author', type: 'text' } } });
    assert.equal(env.hv.data.changeList.author.tag, 'name');
  });

  it('пустые настройки {} допустимы и дают только встроенные поля', async () => {
    env = createEnv({ forum: {} });
    await env.addMask({});
    assert.deepEqual(Object.keys(env.hv.data.changeList).sort(), ['author', 'avatar', 'signature', 'title']);
  });
});

describe('сохранение настроек админом', () => {
  const options = { changeList: { about: { title: 'О себе', tag: 'about', class: 'pa-fld1', type: 'text' } } };

  it('администратор сохраняет переданные настройки на сервер', async () => {
    env = createEnv({ groupId: 1 });
    await env.addMask(options);
    assert.equal(env.state.posts.length, 1);
    assert.equal(env.state.posts[0].key, 'profileMaskSettings');
    assert.equal(env.state.posts[0].token, 'ticket');
    assert.deepEqual(JSON.parse(env.state.posts[0].value), options);
  });

  it('если на сервере те же настройки — повторно не пишет', async () => {
    env = createEnv({ groupId: 1, storage: { profileMaskSettings: JSON.stringify(options) } });
    await env.addMask(options);
    assert.equal(env.state.posts.length, 0);
  });

  it('если настройки изменились — перезаписывает', async () => {
    env = createEnv({ groupId: 1, storage: { profileMaskSettings: JSON.stringify({ changeList: {} }) } });
    await env.addMask(options);
    assert.equal(env.state.posts.length, 1);
  });

  for (const groupId of [2, 3, 4]) {
    it(`группа ${groupId} настройки не сохраняет`, async () => {
      env = createEnv({ groupId });
      await env.addMask(options);
      assert.equal(env.state.posts.length, 0);
    });
  }

  it('другой порядок ключей — это другая строка, настройки перезаписываются', async () => {
    const reordered = { changeList: options.changeList, userFields: ['pa-author'] };
    env = createEnv({ groupId: 1, storage: { profileMaskSettings: JSON.stringify({ userFields: ['pa-author'], changeList: options.changeList }) } });
    await env.addMask(reordered);
    assert.equal(env.state.posts.length, 1);
  });
});

describe('гость в постах', () => {
  it('служебный пользователь id=1 не запрашивается через API', async () => {
    env = createEnv({ users: admin('2') });
    await env.addMask({ guestAccess: [] });
    env.render('<div class="post" id="p1" data-user-id="1"><div class="post-author"><ul><li class="pa-author">Гость</li></ul></div><div class="post-content">[nick]x[/nick]</div></div>');
    assert.equal(env.state.calls.filter(c => c.method === 'users.get').length, 0);
  });
});
