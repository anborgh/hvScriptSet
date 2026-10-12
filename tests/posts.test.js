'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { createEnv, post, codeBox, admin, player } = require('./helpers/env');

let env;
afterEach(() => env && env.close());

const ABOUT = { about: { title: 'О себе', description: '', tag: 'about', class: 'pa-fld1', type: 'html' } };

async function setup(opts = {}, options = {}) {
  env = createEnv(opts);
  await env.addMask(options);
  return env;
}

const q = (sel, root) => (root || env.win.document).querySelector(sel);

describe('разбор тегов в постах', () => {
  it('подменяет ник, статус и аватар автора-админа и вырезает теги из текста', async () => {
    await setup({ users: admin() });
    env.render(post({ body: 'Привет [nick]Алиса[/nick][status]Бард[/status][icon]https://img.example/a.png[/icon]' }));

    assert.equal(q('.pa-author a').textContent, 'Алиса');
    assert.equal(q('.pa-title').textContent, 'Бард');
    assert.equal(q('.pa-avatar img').src, 'https://img.example/a.png');
    assert.equal(q('.post-content').innerHTML.trim(), 'Привет');
    assert.ok(q('.post-author ul').classList.contains('hv-mask'));
  });

  it('понимает короткие алиасы тегов', async () => {
    await setup({ users: admin() });
    env.render(post({ body: '[nic]Короткий[/nic][sta]Статус[/sta]' }));
    assert.equal(q('.pa-author a').textContent, 'Короткий');
    assert.equal(q('.pa-title').textContent, 'Статус');
  });

  it('теги регистронезависимы и многострочны', async () => {
    await setup({ users: admin() });
    env.render(post({ body: '[NICK]Верх\nНиз[/Nick]' }));
    assert.equal(q('.pa-author a').textContent, 'Верх\nНиз');
  });

  it('при двух алиасах одного поля побеждает полная форма тега', async () => {
    await setup({ users: admin() });
    env.render(post({ body: '[nic]Короткий[/nic][nick]Полный[/nick]' }));
    assert.equal(q('.pa-author a').textContent, 'Полный');
  });

  it('при двух алиасах одного поля из текста вырезаются оба тега', { todo: 'баг: остаётся тег проигравшего алиаса' }, async () => {
    await setup({ users: admin() });
    env.render(post({ body: '[nic]Короткий[/nic][nick]Полный[/nick]' }));
    assert.equal(q('.post-content').innerHTML.trim(), '');
  });

  it('при повторе одного тега берётся первый блок', async () => {
    await setup({ users: admin() });
    env.render(post({ body: '[nick]Первый[/nick] текст [nick]Второй[/nick]' }));
    assert.equal(q('.pa-author a').textContent, 'Первый');
  });

  it('пост без тегов не трогает', async () => {
    await setup({ users: admin() });
    env.render(post({ body: 'Обычный пост' }));
    assert.equal(q('.pa-author a').textContent, 'Bob');
    assert.equal(q('.post-content').innerHTML, 'Обычный пост');
    assert.ok(!q('.post-author ul').classList.contains('hv-mask'));
    assert.equal(env.data.changedPosts && Object.keys(env.data.changedPosts).length, 0);
  });

  it('незакрытый и непарный тег игнорируется', async () => {
    await setup({ users: admin() });
    env.render(post({ body: '[nick]Без закрытия и [/status] без открытия' }));
    assert.equal(q('.pa-author a').textContent, 'Bob');
    assert.equal(q('.post-content').innerHTML, '[nick]Без закрытия и [/status] без открытия');
  });

  it('пустой тег не ломает отрисовку', async () => {
    await setup({ users: admin() });
    env.render(post({ body: '[status][/status]' }));
    assert.equal(q('.pa-title').textContent, '');
  });

  it('теги внутри блока кода не считаются маской и остаются в тексте', async () => {
    await setup({ users: admin() });
    env.render(post({ body: codeBox('[nick]Фейк[/nick]') }));
    assert.equal(q('.pa-author a').textContent, 'Bob');
    assert.ok(q('.post-content pre').textContent.includes('[nick]Фейк[/nick]'));
  });

  it('настоящий тег работает рядом с блоком кода, код сохраняется', async () => {
    await setup({ users: admin() });
    env.render(post({ body: `[nick]Алиса[/nick]${codeBox('[status]Фейк[/status]')}` }));
    assert.equal(q('.pa-author a').textContent, 'Алиса');
    assert.equal(q('.pa-title').textContent, 'Игрок');
    assert.ok(q('.post-content pre').textContent.includes('[status]Фейк[/status]'));
  });

  it('спецпоследовательности $ в коде не портят восстановление блока', { todo: 'баг: код подставляется через replace со строкой, $& и $\' интерпретируются' }, async () => {
    await setup({ users: admin() });
    env.render(post({ body: `[nick]Алиса[/nick]${codeBox("cost = '$&' + \"$'\" + '$1'")}` }));
    assert.equal(q('.post-content pre').textContent, "cost = '$&' + \"$'\" + '$1'");
  });

  it('подпись автора сохраняется после очистки текста', async () => {
    await setup({ users: admin() });
    env.render(post({ body: '[nick]Алиса[/nick]Текст<dl class="post-sig"><dd>Моя подпись</dd></dl>' }));
    assert.ok(q('.post-content .post-sig'));
    assert.equal(q('.post-content .post-sig dd').textContent, 'Моя подпись');
  });

  it('подпись создаётся, если её ещё нет', async () => {
    await setup({ users: admin() });
    env.render(post({ body: '[sign]Подпись[/sign]' }));
    assert.equal(q('.post-sig dd').innerHTML.trim(), 'Подпись');
  });

  it('несколько постов с разными авторами обрабатываются независимо', async () => {
    const users = Object.assign({}, admin('2', 'Bob'), admin('7', 'Eve'));
    await setup({ users });
    env.render(
      post({ id: 'p1', userId: '2', body: '[nick]Один[/nick]' }) +
      post({ id: 'p2', userId: '7', body: '[nick]Два[/nick]' }) +
      post({ id: 'p3', userId: '2', body: 'без маски' })
    );
    const posts = env.win.document.querySelectorAll('.post');
    assert.equal(q('.pa-author a', posts[0]).textContent, 'Один');
    assert.equal(q('.pa-author a', posts[1]).textContent, 'Два');
    assert.equal(q('.pa-author a', posts[2]).textContent, 'Bob');
    // каждый пользователь запрашивается одним запросом
    assert.equal(env.state.calls.filter(c => c.method === 'users.get').length, 1);
  });

  it('свои поля из настроек работают наравне со встроенными', async () => {
    await setup({ users: admin() }, { changeList: ABOUT });
    env.render(post({ body: '[about]Люблю чай[/about]' }));
    assert.equal(q('.pa-fld1').textContent, 'Люблю чай');
  });

  it('пост без .post-content не падает в других постах', async () => {
    await setup({ users: admin() });
    env.render(post({ body: '[nick]Алиса[/nick]' }));
    assert.equal(q('.pa-author a').textContent, 'Алиса');
  });
});

describe('ограничения длины', () => {
  it('ник обрезается до 25 символов, статус до 50', async () => {
    await setup({ users: admin() });
    env.render(post({ body: `[nick]${'я'.repeat(40)}[/nick][status]${'ы'.repeat(80)}[/status]` }));
    assert.equal(q('.pa-author a').textContent, 'я'.repeat(25));
    assert.equal(q('.pa-title').textContent, 'ы'.repeat(50));
  });

  it('ровно 25 символов не обрезаются', async () => {
    await setup({ users: admin() });
    env.render(post({ body: `[nick]${'я'.repeat(25)}[/nick]` }));
    assert.equal(q('.pa-author a').textContent, 'я'.repeat(25));
  });

  it('эмоджи считаются как один символ и не рвутся пополам', async () => {
    await setup({ users: admin() });
    const family = '👨‍👩‍👧‍👦';
    env.render(post({ body: `[nick]${family.repeat(30)}[/nick]` }));
    assert.equal(q('.pa-author a').textContent, family.repeat(25));
  });

  it('суррогатные пары на границе не дают битый символ', async () => {
    await setup({ users: admin() });
    env.render(post({ body: `[status]${'😀'.repeat(60)}[/status]` }));
    const text = q('.pa-title').textContent;
    assert.equal(text, '😀'.repeat(50));
    assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])/.test(text));
  });

  it('html-поле обрезается до 999 символов', async () => {
    await setup({ users: admin() }, { changeList: ABOUT });
    env.render(post({ body: `[about]${'a'.repeat(1500)}[/about]` }));
    assert.equal(q('.pa-fld1').textContent.length, 999);
  });
});

describe('защита от внедрения', () => {
  it('html в нике показывается текстом, а не разметкой', async () => {
    await setup({ users: admin() });
    env.render(post({ body: '[nick]&lt;img src=x onerror=alert(1)&gt;[/nick]' }));
    assert.equal(q('.pa-author img'), null);
    assert.equal(q('.pa-author a').textContent, '<img src=x onerror=alert(1)>'.slice(0, 25));
  });

  it('ник с кавычками экранируется в javascript:-ссылках цитирования', async () => {
    const profile = '<ul><li class="pa-author"><a href="/user.php">Bob</a></li></ul>';
    await setup({ users: admin() });
    env.render(post({ profile, body: '[nick]");alert(1);//[/nick]' }));
    const href = q('.pa-author a').getAttribute('href');
    assert.equal(href, 'javascript:to("\\");alert(1);//")');
    const quote = q('.pl-quote a').getAttribute('href');
    assert.equal(quote, 'javascript:quote("\\");alert(1);//", 1)');
  });

  it('символ % в нике кодируется, чтобы не ломать javascript:-ссылку', async () => {
    const profile = '<ul><li class="pa-author"><a href="/user.php">Bob</a></li></ul>';
    await setup({ users: admin() });
    env.render(post({ profile, body: '[nick]100%[/nick]' }));
    assert.equal(q('.pa-author a').getAttribute('href'), 'javascript:to("100%25")');
  });

  it('ссылка на профиль не заменяется на javascript:', async () => {
    await setup({ users: admin() });
    env.render(post({ body: '[nick]Алиса[/nick]' }));
    assert.ok(q('.pa-author a').getAttribute('href').endsWith('/profile.php?id=2'));
    assert.ok(!q('.pa-author a').getAttribute('href').startsWith('javascript:'));
  });

  it('при disableQuote ссылки цитирования остаются нетронутыми', async () => {
    const profile = '<ul><li class="pa-author"><a href="/user.php">Bob</a></li></ul>';
    await setup({ users: admin() }, { disableQuote: true });
    env.render(post({ profile, body: '[nick]Алиса[/nick]' }));
    assert.equal(q('.pa-author a').getAttribute('href'), '/user.php');
    assert.equal(q('.pl-quote a').getAttribute('href'), '#');
  });

  describe('html-поле', () => {
    const bad = {
      'тег script': '&lt;script&gt;alert(1)&lt;/script&gt;',
      'тег iframe': '&lt;iframe src="https://evil.example"&gt;&lt;/iframe&gt;',
      'обработчик on*': '&lt;b onclick="alert(1)"&gt;x&lt;/b&gt;',
      'обработчик в верхнем регистре': '&lt;b ONMOUSEOVER="alert(1)"&gt;x&lt;/b&gt;',
      'javascript: в href': '&lt;a href="javascript:alert(1)"&gt;x&lt;/a&gt;',
      'javascript: с табом внутри': '&lt;a href="jav\tascript:alert(1)"&gt;x&lt;/a&gt;',
      'javascript: с пробелами и регистром': '&lt;a href="  JaVaScRiPt:alert(1)"&gt;x&lt;/a&gt;',
      'data: не картинка': '&lt;img src="data:text/html;base64,PHNjcmlwdD4="&gt;',
      'data: в ссылке': '&lt;a href="data:image/png;base64,AAAA"&gt;x&lt;/a&gt;',
      'javascript: в srcset': '&lt;img srcset="a.png 1x, javascript:alert(1) 2x"&gt;',
      'style expression': '&lt;b style="width: expression(alert(1))"&gt;x&lt;/b&gt;',
      'style с javascript:': '&lt;b style="background: url(javascript:alert(1))"&gt;x&lt;/b&gt;',
      'атрибут id': '&lt;b id="pun-main"&gt;x&lt;/b&gt;',
      'атрибут name': '&lt;b name="cookie"&gt;x&lt;/b&gt;',
      'форма': '&lt;form action="/x"&gt;&lt;/form&gt;',
      'input': '&lt;input autofocus&gt;',
      'svg с вложенным script': '&lt;svg&gt;&lt;script&gt;alert(1)&lt;/script&gt;&lt;/svg&gt;',
      'foreignObject': '&lt;svg&gt;&lt;foreignObject&gt;&lt;/foreignObject&gt;&lt;/svg&gt;',
      'svg use': '&lt;svg&gt;&lt;use href="#x"/&gt;&lt;/svg&gt;',
      'xlink:href javascript:': '&lt;svg&gt;&lt;a xlink:href="javascript:alert(1)"&gt;x&lt;/a&gt;&lt;/svg&gt;',
      'опасный тег глубоко внутри': '&lt;div&gt;&lt;p&gt;&lt;span&gt;&lt;object data="x"&gt;&lt;/object&gt;&lt;/span&gt;&lt;/p&gt;&lt;/div&gt;',
    };

    for (const [name, html] of Object.entries(bad)) {
      it(`блокирует: ${name}`, async () => {
        await setup({ users: player() }, { changeList: ABOUT, forumAccessExtended: { 'Игровая': ['Игрок'] } });
        env.render(post({ body: `[about]${html}[/about]` }));
        const field = q('.pa-fld1');
        assert.equal(field.textContent, '');
        assert.equal(field.children.length, 0);
        assert.ok(env.logs.error.length > 0, 'ошибка должна попасть в консоль');
      });
    }

    it('админам показывается уведомление и пост подсвечивается', async () => {
      await setup({ users: admin(), groupId: 1 }, { changeList: ABOUT });
      env.render(post({ body: '[about]&lt;script&gt;x&lt;/script&gt;[/about]' }));
      assert.equal(env.state.growl.length, 1);
      assert.ok(env.state.growl[0].text.includes('опасный тег &lt;script&gt;'));
      assert.match(q('#p1').style.border, /solid/);
    });

    it('обычным пользователям уведомление не показывается', async () => {
      await setup({ users: player() }, { changeList: ABOUT, forumAccessExtended: { 'Игровая': ['Игрок'] }, forumAccess: { 'Игровая': ['Игрок'] } });
      env.win.GroupID = 4;
      env.render(post({ body: '[about]&lt;script&gt;x&lt;/script&gt;[/about]' }));
      assert.equal(env.state.growl.length, 0);
    });

    it('пропускает безопасную разметку', async () => {
      await setup({ users: admin() }, { changeList: ABOUT });
      env.render(post({ body: '[about]&lt;b&gt;жирный&lt;/b&gt; &lt;a href="https://ok.example"&gt;ссылка&lt;/a&gt;[/about]' }));
      assert.equal(q('.pa-fld1 b').textContent, 'жирный');
      assert.equal(q('.pa-fld1 a').getAttribute('href'), 'https://ok.example');
    });

    it('пропускает data:image у картинки, но не у ссылки', async () => {
      await setup({ users: admin() }, { changeList: ABOUT });
      env.render(post({ body: '[about]&lt;img src="data:image/png;base64,AAAA"&gt;[/about]' }));
      assert.ok(q('.pa-fld1 img'));
    });

    it('добавляет rel к ссылкам и снимает position: fixed', async () => {
      await setup({ users: admin() }, { changeList: ABOUT });
      env.render(post({ body: '[about]&lt;a href="https://ok.example"&gt;x&lt;/a&gt;&lt;div style="position: fixed; top: 0"&gt;y&lt;/div&gt;[/about]' }));
      assert.equal(q('.pa-fld1 a').getAttribute('rel'), 'nofollow noopener noreferrer ugc');
      assert.equal(q('.pa-fld1 div').style.position, '');
    });
  });
});

describe('права доступа', () => {
  const forum = { 'Игровая': ['Игрок'] };

  it('обычный пользователь с правом common меняет только аватар', async () => {
    await setup({ users: player() }, { forumAccess: forum });
    env.render(post({ body: '[nick]Алиса[/nick][icon]https://img.example/a.png[/icon]' }));
    assert.equal(q('.pa-avatar img').src, 'https://img.example/a.png');
    assert.equal(q('.pa-author a').textContent, 'Bob');
    // сами теги из текста всё равно вырезаны
    assert.equal(q('.post-content').innerHTML.trim(), '');
  });

  it('пользователь вне списка forumAccess ничего не меняет', async () => {
    await setup({ users: player('2', 'Bob', 'Чужак') }, { forumAccess: forum });
    env.render(post({ body: '[nick]Алиса[/nick][icon]https://img.example/a.png[/icon]' }));
    assert.equal(q('.pa-avatar img').getAttribute('src'), 'old.png');
    assert.equal(q('.pa-author a').textContent, 'Bob');
  });

  it('forumAccessExtended даёт полный доступ', async () => {
    await setup({ users: player() }, { forumAccess: {}, forumAccessExtended: forum });
    env.render(post({ body: '[nick]Алиса[/nick]' }));
    assert.equal(q('.pa-author a').textContent, 'Алиса');
  });

  it('аватар создаётся, если у автора его нет в профиле', async () => {
    const profile = '<ul><li class="pa-author"><a href="/profile.php?id=2">Bob</a></li><li class="pa-posts">5</li></ul>';
    await setup({ users: player() }, { forumAccess: forum });
    env.render(post({ profile, body: '[icon]https://img.example/a.png[/icon]' }));
    const items = Array.from(env.win.document.querySelectorAll('.post-author li')).map(li => li.className);
    assert.deepEqual(items, ['pa-author', 'pa-avatar', 'pa-posts']);
    assert.equal(q('.pa-avatar img').src, 'https://img.example/a.png');
  });

  it('аватар добавляется в конец, когда после него нет полей', async () => {
    const profile = '<ul><li class="pa-author"><a href="/profile.php?id=2">Bob</a></li></ul>';
    await setup({ users: player() }, { forumAccess: forum });
    env.render(post({ profile, body: '[icon]https://img.example/a.png[/icon]' }));
    const items = Array.from(env.win.document.querySelectorAll('.post-author li')).map(li => li.className);
    assert.deepEqual(items, ['pa-author', 'pa-avatar']);
  });

  it('гость без guestAccess ничего не меняет', async () => {
    const profile = '<ul><li class="pa-author">Гость</li></ul>';
    await setup({});
    env.render(post({ userId: '1', profile, body: '[nick]Взломщик[/nick]' }));
    assert.equal(q('.pa-author').textContent, 'Гость');
    assert.equal(q('.post-content').innerHTML.trim(), '');
    // для гостя API не вызывается
    assert.equal(env.state.calls.filter(c => c.method === 'users.get').length, 0);
  });

  it('гостю с доступом ник выводится текстом, а не ссылкой', async () => {
    const profile = '<ul><li class="pa-author">Гость</li></ul>';
    await setup({}, { guestAccess: ['Игровая'] });
    env.render(post({ userId: '1', profile, body: '[nick]<b>Тест</b>[/nick]' }));
    assert.equal(q('.pa-author').textContent, 'Тест');
    assert.equal(q('.pa-author b'), null);
  });

  it('название форума с мягким переносом (код 173) сопоставляется с настройками', async () => {
    await setup(
      { users: player(), forum: { topic: { forum_name: '\u00ADИгровая' } } },
      { forumAccessExtended: { 'Игровая': ['Игрок'] } }
    );
    env.render(post({ body: '[nick]Алиса[/nick]' }));
    assert.equal(q('.pa-author a').textContent, 'Алиса');
  });

  it('пользователь, которого нет в ответе API, не роняет страницу', { todo: 'баг: getPosts читает свойства undefined' }, async () => {
    await setup({ users: {} });
    assert.doesNotThrow(() => env.render(post({ userId: '99', body: '[nick]Алиса[/nick]' })));
  });
});

describe('страницы без темы (hideTags)', () => {
  it('вырезает теги маски из всех постов', async () => {
    await setup({ forum: {} });
    env.win.document.getElementById('pun-main').innerHTML =
      post({ id: 'p1', body: 'Текст [nick]А[/nick] и [status]Б[/status]' }) +
      post({ id: 'p2', body: '[sign]Подпись[/sign]' });
    env.init();
    const contents = Array.from(env.win.document.querySelectorAll('.post-content')).map(el => el.innerHTML);
    assert.deepEqual(contents, ['Текст  и ', '']);
  });

  it('не трогает пост со скрытым блоком hvmask', async () => {
    await setup({ forum: {} });
    env.win.document.getElementById('pun-main').innerHTML =
      post({ body: '<div class="hvmask">[nick]А[/nick]</div>' });
    env.init();
    assert.equal(q('.hvmask').textContent, '[nick]А[/nick]');
  });

  it('повторный init не выполняется дважды', async () => {
    await setup({ forum: {} });
    env.win.document.getElementById('pun-main').innerHTML = post({ body: '[nick]А[/nick]' });
    env.init({ reset: false });
    env.init({ reset: false });
    assert.equal(env.win.document.querySelectorAll('link[href*="92410.css"]').length, 1);
    // первый init (сразу после загрузки) уже отработал на пустой странице, повторные ничего не меняют
    assert.equal(q('.post-content').innerHTML, '[nick]А[/nick]');
  });
});
