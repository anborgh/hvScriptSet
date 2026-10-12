'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const SRC = fs.readFileSync(path.join(__dirname, '../../hvss.js'), 'utf8');

const SPLIT_KEY = '|splitKey|';
const STORAGE_LIMIT = 65500;

const DEFAULT_HTML = `<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body>
<div id="pun-crumbs1"><a href="/viewforum.php?id=1">Игровая</a></div>
<div id="pun-main"></div></body></html>`;

const PROFILE = `<ul>
  <li class="pa-author"><a href="/profile.php?id=2">Bob</a></li>
  <li class="pa-title">Игрок</li>
  <li class="pa-avatar"><img src="old.png" title="Bob"></li>
</ul>`;

// Мини-замена jQuery: только то, что реально вызывает hvss.js. Ajax синхронный и работает с state.storage.
function makeJQuery(win, state) {
  const wrap = els => {
    const api = {
      els,
      on(name, fn) {
        if (els[0] === win.document) state.handlers[name] = fn;
        return api;
      },
      find(sel) {
        return wrap(els.flatMap(el => Array.from(el.querySelectorAll(sel))));
      },
      attr(name, value) {
        els.forEach(el => el.setAttribute(name, value));
        return api;
      },
      tipsy() {
        return api;
      },
    };
    return api;
  };

  const $ = arg => {
    if (typeof arg === 'string') return wrap(Array.from(win.document.querySelectorAll(arg)));
    return wrap(arg ? [arg] : []);
  };

  $.jGrowl = (text, opts) => state.growl.push({ text, opts });

  $.ajax = opts => {
    const data = opts.data || {};
    const xhr = { status: 200 };
    state.calls.push(Object.assign({ type: opts.type || 'GET' }, data));

    if (data.method === 'users.get') {
      opts.success({ response: { users: state.users } }, 'success', xhr);
      return;
    }

    if (data.method === 'storage.get') {
      if (data.key === 'maskListUser') {
        if (state.failRead) {
          xhr.status = 0;
          opts.error(xhr, state.failRead === 'timeout' ? 'timeout' : 'error');
          return;
        }
        if (state.readResponse !== undefined) {
          opts.success(state.readResponse, 'success', xhr);
          return;
        }
      }
      if (!(data.key in state.storage)) {
        opts.success({ error: { code: 404 } }, 'success', xhr);
        return;
      }
      opts.success({ response: { storage: { data: { [data.key]: state.storage[data.key] } } } }, 'success', xhr);
      return;
    }

    if (data.method === 'storage.set') {
      if (state.failWrite) {
        xhr.status = 500;
        opts.error(xhr, state.failWrite === 'timeout' ? 'timeout' : 'error');
        return;
      }
      if (state.writeResponse !== undefined) {
        opts.success(state.writeResponse, 'success', xhr);
        return;
      }
      state.storage[data.key] = data.value;
      opts.success({ response: 1 }, 'success', xhr);
    }
  };

  $.post = (url, data) => {
    state.posts.push(data);
    return {};
  };

  $.get = () => Promise.resolve(state.settingsResponse);

  return $;
}

/**
 * Поднимает jsdom, подключает hvss.js и возвращает окружение.
 * opts: { html, url, groupId, groupTitle, forum, users, storage, beforeEval(win, state) }
 */
const plain = value => (value === undefined ? value : JSON.parse(JSON.stringify(value)));

function createEnv(opts = {}) {
  const logs = { log: [], warn: [], error: [] };
  const errors = [];
  const virtualConsole = new VirtualConsole();
  ['log', 'warn', 'error'].forEach(level => virtualConsole.on(level, (...args) => logs[level].push(args)));
  virtualConsole.on('jsdomError', err => errors.push(err));

  const dom = new JSDOM(opts.html || DEFAULT_HTML, {
    url: opts.url || 'https://forum.example/viewtopic.php?id=5',
    runScripts: 'outside-only',
    virtualConsole,
  });
  const win = dom.window;

  const state = {
    storage: Object.assign({}, opts.storage),
    users: opts.users || {},
    failRead: false,
    failWrite: false,
    readResponse: undefined,
    writeResponse: undefined,
    settingsResponse: undefined,
    calls: [],
    posts: [],
    growl: [],
    handlers: {},
  };

  win.$ = makeJQuery(win, state);
  win.jQuery = win.$;
  win.FORUM = opts.forum !== undefined ? opts.forum : { topic: { forum_name: 'Игровая' } };
  win.GroupID = opts.groupId !== undefined ? opts.groupId : 4;
  win.GroupTitle = opts.groupTitle || 'Игрок';
  win.UserID = 3;
  win.UserLogin = 'Me';
  win.ForumAPITicket = 'ticket';
  win.confirm = () => true;

  if (opts.beforeEval) opts.beforeEval(win, state);
  win.eval(SRC + '\n;window.hvScriptSet = hvScriptSet;');

  const env = {
    win,
    state,
    logs,
    errors,
    hv: win.hvScriptSet,
    get data() {
      return win.hvScriptSet.data;
    },
    // Код скрипта живёт в realm jsdom, поэтому его объекты нужно приводить к «чистым» для deepEqual.
    import: (input, options) => plain(win.hvScriptSet.data.import(input, options)),
    report: options => plain(win.hvScriptSet.data.report(options)),
    addMask: options => win.hvScriptSet.addMask(options),
    /** Кладёт посты в #pun-main и запускает getPosts через событие pun_post. */
    render(postsHtml) {
      win.document.getElementById('pun-main').innerHTML = postsHtml;
      state.handlers.pun_post();
    },
    /**
     * Запускает init() как это делает браузер. jsdom сам отправляет DOMContentLoaded сразу после создания,
     * поэтому по умолчанию сбрасываем флаг inited, чтобы init отработал уже на подготовленной странице.
     */
    init({ reset = true } = {}) {
      if (reset) win.hvScriptSet.inited = false;
      win.document.dispatchEvent(new win.Event('DOMContentLoaded'));
    },
    /** Содержимое хранилища масок в виде объектов. */
    storedMasks() {
      const raw = state.storage.maskListUser;
      if (!raw) return [];
      return decodeURI(raw).split(SPLIT_KEY).filter(Boolean).map(str => JSON.parse(str));
    },
    close: () => win.close(),
  };
  return env;
}

function post({ id = 'p1', userId = '2', body = '', profile = PROFILE, extra = '' } = {}) {
  return `<div class="post" id="${id}" data-user-id="${userId}">
    <div class="post-author">${profile}</div>
    <div class="pl-quote"><a href="#">Цитировать</a></div>
    <div class="post-content">${body}</div>${extra}
  </div>`;
}

function codeBox(text) {
  return `<div class="code-box"><strong class="legend">Код:</strong><div class="blockcode">` +
    `<div class="scrollbox" style="width: 100%"><pre>${text}</pre></div></div></div>`;
}

const admin = (id = '2', name = 'Bob') => ({ [id]: { user_id: id, username: name, group_id: '1', group_title: 'Администратор' } });
const player = (id = '2', name = 'Bob', title = 'Игрок') => ({ [id]: { user_id: id, username: name, group_id: '4', group_title: title } });

const mask = (value, tag = 'nick') => ({ author: { tag, value } });
const rawMasks = list => list.map(m => (typeof m === 'string' ? m : JSON.stringify(m))).join(SPLIT_KEY);

module.exports = { createEnv, post, codeBox, admin, player, mask, rawMasks, SPLIT_KEY, STORAGE_LIMIT };
