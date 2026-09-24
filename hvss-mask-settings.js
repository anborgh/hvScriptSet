/**
 * Форма настроек маски профиля.
 * Зависит от HvScriptManager (hvss-settings.js), но может грузиться раньше:
 *   window.HvScriptManager = window.HvScriptManager || [];
 *   HvScriptManager.push(formDef);
 */
(function hvssMaskSettings() {
  const FORM_ID = 'profile-mask';
  const STORAGE_KEY = 'profileMaskSettings';
  const PA_FLD_OPTIONS = Array.from({ length: 20 }, (_, i) => 'pa-fld' + (i + 1));

  const DEFAULT_SETTINGS = {
    changeList: {},
    userFields: ['pa-author', 'pa-title', 'pa-avatar', 'pa-fld1', 'pa-reg',
      'pa-posts', 'pa-respect', 'pa-positive', 'pa-awards', 'pa-gifts'],
    defaultAvatar: 'https://i.imgur.com/bQuC3S1.png',
    maskLimit: 20,
    disableQuote: false,
    guestAccess: [],
    forumAccess: {},
    forumAccessExtended: {},
    buttonImage: 'https://i.imgur.com/ONu0llO.png',
    showPreview: true,
  };

  const FORBIDDEN_HTML_TAGS = ['input', 'button', 'script', 'iframe', 'frame', 'frameset', 'style', 'audio', 'video',
    'form', 'footer', 'header', 'head', 'html', 'body', 'map', 'select', 'textarea', 'xmp', 'object', 'embed',
    'noembed', 'var', 'meta', 'animate', 'animatemotion', 'animatetransform', 'xss', 'main', 'aside', 'dialog',
    'noscript', 'noframes', 'title', 'set', 'use', 'base', 'math', 'link', 'template', 'portal', 'applet', 'slot',
    'plaintext', 'listing', 'source', 'track', 'param', 'fencedframe', 'handler', 'listener', 'discard',
    'foreignobject'];
  const FORBIDDEN_HTML_ATTRIBUTES = ['id', 'name', 'form', 'formaction', 'action', 'srcdoc', 'autofocus',
    'contenteditable', 'popover', 'popovertarget', 'popovertargetaction', 'command', 'commandfor', 'is',
    'http-equiv', 'autoplay', 'ping', 'xmlns'];
  const URL_HTML_ATTRIBUTES = ['href', 'src', 'action', 'formaction', 'background', 'poster', 'data', 'codebase',
    'cite', 'longdesc', 'dynsrc', 'lowsrc', 'srcset', 'xlink:href'];

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function sanitizeBbTag(raw) {
    return String(raw || '').replace(/[^A-Za-z]/g, '');
  }

  function isForbiddenUrl(element, value) {
    const url = value.replace(/[\u0000-\u0020\u007f-\u009f]/g, '').toLowerCase();
    if (/^(javascript|vbscript|livescript|mocha):/.test(url)) {
      return true;
    }
    if (url.startsWith('data:')) {
      return !(element.localName === 'img' && /^data:image\/(png|gif|jpe?g|webp|avif);/.test(url));
    }
    return false;
  }

  function getAttributeViolation(element, attr) {
    const name = attr.name.toLowerCase();
    const tag = element.localName.toLowerCase();
    const forbiddenAttribute = `запрещённый атрибут ${attr.name} в теге <${tag}>`;
    const forbiddenValue = `недопустимое значение атрибута ${attr.name} в теге <${tag}>`;
    if (name.startsWith('on')) {
      return forbiddenAttribute;
    }
    if (FORBIDDEN_HTML_ATTRIBUTES.includes(name) || name.startsWith('xmlns:')) {
      return forbiddenAttribute;
    }
    if (URL_HTML_ATTRIBUTES.includes(name) || attr.localName === 'href') {
      const isForbidden = name === 'srcset'
        ? attr.value.split(',').some(part => isForbiddenUrl(element, part.trim()))
        : isForbiddenUrl(element, attr.value);
      return isForbidden ? forbiddenValue : '';
    }
    if (name === 'style' && /expression\s*\(|-moz-binding|behavior\s*:|javascript:/i.test(attr.value)) {
      return forbiddenValue;
    }
    return '';
  }

  function getHtmlViolation(html) {
    const source = String(html || '');
    if (!source) {
      return '';
    }
    const template = document.createElement('template');
    template.innerHTML = source;
    const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_ELEMENT);
    while (walker.nextNode()) {
      const element = walker.currentNode;
      const tag = element.localName.toLowerCase();
      if (FORBIDDEN_HTML_TAGS.includes(tag)) {
        return `запрещённый тег <${tag}>`;
      }
      const attributes = Array.prototype.slice.call(element.attributes);
      for (let i = 0; i < attributes.length; i++) {
        const violation = getAttributeViolation(element, attributes[i]);
        if (violation) {
          return violation;
        }
      }
    }
    return '';
  }

  function extractAddMaskArgs(raw) {
    const marker = 'hvScriptSet.addMask';
    const markerIndex = raw.indexOf(marker);
    if (markerIndex === -1) {
      return null;
    }
    const openParenIndex = raw.indexOf('(', markerIndex);
    if (openParenIndex === -1) {
      return null;
    }
    let depth = 1;
    let inSingle = false;
    let inDouble = false;
    let inTemplate = false;
    let escaped = false;
    for (let index = openParenIndex + 1; index < raw.length; index += 1) {
      const char = raw[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (!inDouble && !inTemplate && char === "'") {
        inSingle = !inSingle;
        continue;
      }
      if (!inSingle && !inTemplate && char === '"') {
        inDouble = !inDouble;
        continue;
      }
      if (!inSingle && !inDouble && char === '`') {
        inTemplate = !inTemplate;
        continue;
      }
      if (inSingle || inDouble || inTemplate) {
        continue;
      }
      if (char === '(') {
        depth += 1;
        continue;
      }
      if (char === ')') {
        depth -= 1;
        if (depth === 0) {
          return raw.slice(openParenIndex + 1, index).trim();
        }
      }
    }
    return null;
  }

  function detectUserFieldsFromDoc(doc) {
    const author = doc.querySelector('.post-author');
    if (!author) {
      return [];
    }
    const fields = [];
    author.querySelectorAll('li[class]').forEach(li => {
      const firstClass = (li.className || '').trim().split(/\s+/)[0];
      if (firstClass && fields.indexOf(firstClass) === -1) {
        fields.push(firstClass);
      }
    });
    return fields;
  }

  function normalizeSettings(opts, base) {
    const defaults = base || clone(DEFAULT_SETTINGS);
    if (!opts || typeof opts !== 'object') {
      return clone(defaults);
    }
    const changeList = {};
    const rawChangeList = opts.changeList && typeof opts.changeList === 'object' ? opts.changeList : {};
    Object.keys(rawChangeList).forEach(key => {
      const raw = rawChangeList[key];
      if (!raw || typeof raw !== 'object') {
        return;
      }
      const type = raw.type === 'bbtag' ? 'bbcode' : (raw.type || 'html');
      const entry = {
        title: String(raw.title || key),
        description: String(raw.description || ''),
        tag: String(raw.tag || ''),
        class: String(raw.class || key),
        type: ['html', 'bbcode', 'text'].indexOf(type) !== -1 ? type : 'html',
      };
      if (raw.defaultCode !== undefined && raw.defaultCode !== '') {
        entry.defaultCode = raw.defaultCode;
      }
      changeList[entry.class || key] = entry;
    });
    return {
      changeList,
      guestAccess: Array.isArray(opts.guestAccess) ? opts.guestAccess : [],
      forumAccess: opts.forumAccess && typeof opts.forumAccess === 'object' ? opts.forumAccess : {},
      forumAccessExtended: opts.forumAccessExtended && typeof opts.forumAccessExtended === 'object'
        ? opts.forumAccessExtended
        : {},
      userFields: Array.isArray(opts.userFields) && opts.userFields.length
        ? opts.userFields.map(String)
        : defaults.userFields.slice(),
      maskLimit: Number(opts.maskLimit) > 0 ? Number(opts.maskLimit) : defaults.maskLimit,
      disableQuote: Boolean(opts.disableQuote),
      showPreview: opts.showPreview !== false,
      defaultAvatar: String(opts.defaultAvatar || defaults.defaultAvatar),
      buttonImage: String(opts.buttonImage || defaults.buttonImage),
    };
  }

  function buildStoragePayload(settings) {
    return {
      guestAccess: Array.isArray(settings.guestAccess) ? settings.guestAccess : [],
      forumAccess: settings.forumAccess || {},
      forumAccessExtended: settings.forumAccessExtended || {},
      changeList: settings.changeList || {},
      userFields: settings.userFields || [],
      maskLimit: settings.maskLimit || 20,
      defaultAvatar: settings.defaultAvatar,
      buttonImage: settings.buttonImage,
      disableQuote: Boolean(settings.disableQuote),
      showPreview: settings.showPreview !== false,
    };
  }

  function mergeGroupsFromSettings(groups, settings) {
    const names = new Set(groups.map(g => g.name));
    const collect = map => {
      Object.keys(map || {}).forEach(forumName => {
        const list = map[forumName];
        if (!Array.isArray(list)) {
          return;
        }
        list.forEach(name => {
          if (name && !names.has(name)) {
            names.add(name);
            groups.push({ id: 's-' + (groups.length + 1), name });
          }
        });
      });
    };
    collect(settings.forumAccess);
    collect(settings.forumAccessExtended);
    groups.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    groups.forEach((group, index) => {
      group.id = String(index + 1);
    });
    return groups;
  }

  async function checkManual() {
    const result = {
      scriptFound: false,
      isManual: false,
      error: '',
      detectedUserFields: [],
    };
    try {
      const html = await $.get('/');
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const remoteScripts = Array.prototype.slice.call(doc.querySelectorAll('script'));
      let found = false;
      let hasParams = false;
      for (let i = 0; i < remoteScripts.length; i++) {
        const text = remoteScripts[i].textContent || '';
        if (!/hvScriptSet\.addMask\s*\(/.test(text)) {
          continue;
        }
        found = true;
        const args = extractAddMaskArgs(text);
        hasParams = Boolean(args && args.trim().length > 0);
        break;
      }
      result.scriptFound = found;
      result.isManual = found && hasParams;
      result.error = found ? '' : 'Скрипт маски не найден на главной странице форума.';
      result.detectedUserFields = detectUserFieldsFromDoc(doc);
    } catch (e) {
      result.error = 'Не удалось проверить вызов hvScriptSet.addMask().';
      console.error(e);
    }
    return result;
  }

  function injectMaskStyles() {
    if (document.getElementById('hvss-mask-settings-style')) {
      return;
    }
    const style = document.createElement('style');
    style.id = 'hvss-mask-settings-style';
    style.textContent = `
.hvwrapper .notes { margin: 0 0 12px; }
.hvwrapper .notes .hv-note { padding: 10px 12px; margin: 0 0 8px; border: 1px solid; }
.hvwrapper .notes .hv-note-warn { background: #fff3cd; border-color: #e0c36a; color: #6a5300; }
.hvwrapper .notes .hv-note-error { background: #f8d7da; border-color: #e0a0a8; color: #6a1a22; }
.hvwrapper .notes .hv-note-ok { background: #d4edda; border-color: #9dcfb0; color: #1e5a32; }
.hvwrapper .notes code { background: rgba(0,0,0,.06); padding: 1px 4px; }
#pun-admain #accessForm .isarchive { color: #888; margin-right: 6px; }
.hvss-settings-dialog .access-group-chip,
#pun-admain .access-group-chip { display: inline-block; margin: 2px; padding: 3px 8px; cursor: grab; user-select: none; }
.hvss-settings-dialog .access-group-chip.dragging { opacity: .5; }
.hvss-settings-dialog .access-drop-zone { min-width: 140px; min-height: 80px; vertical-align: top; padding: 6px; border: 1px dashed; }
.hvss-settings-dialog .access-drop-zone.drag-over { outline: 2px solid; }
#pun-admain .hvss-settings-dialog .hv-form-block .hv-mask-field { margin-top: 10px; }
.hvss-settings-dialog .hv-form-block label { display: block; margin-bottom: 2px; }
.hvss-settings-dialog .hv-form-block input,
.hvss-settings-dialog .hv-form-block select,
.hvss-settings-dialog .hv-form-block textarea { width: 100%; }
.hvss-settings-dialog .hv-description { font-size: .9em; font-style: italic; margin-bottom: 4px; }
#pun-admain .adinput img { max-height: 40px; vertical-align: middle; margin-left: 4px; }
#pun-admain .adinput img.hv-btn-preview { max-height: 20px; }
#pun-admain #changelistForm.adcontainer { margin-top: 4px; }
#pun-admain .hv-dup-tag { color: #a33; font-size: .9em; }
.hvss-settings-dialog .af-templates input.af-invalid { border: solid 1px #f00; }
.hvss-settings-dialog .af-templates .af-violation { color: #a33; font-size: .9em; margin: -2px 0 6px; }
.hvss-settings-dialog .af-templates .af-entry .af-violation { grid-column: 1 / -1; margin: 0; }
#pun-admain .fielditem .tcl span { color: #777; }
#pun-admain .button-danger { color: #a33; }
.hvss-settings-dialog { display: none; }
.hvss-settings-dialog .hv-bg {
  position: fixed; display: flex; align-content: center; justify-content: center; align-items: center;
  z-index: 1000; width: 100%; height: 100%; left: 0; top: 0; background: rgba(0,0,0,.4); cursor: pointer;
}
.hvss-settings-dialog .inner {
  cursor: default; margin: 0; width: 760px; max-width: 99%; max-height: 90%; overflow: auto; z-index: 100;
  box-shadow: 0 0 40px #222; padding: 8px; background: #F4F5F6 url("https://i.imgur.com/akmlat3.png");
}
.hvss-settings-dialog .inner * { box-sizing: border-box; }
.hvss-settings-dialog .hv-mask-dialog-title {
  text-align: center; font-weight: 700; font-size: 18px; line-height: 34px; position: relative;
}
.hvss-settings-dialog .hv-control {
  position: relative; display: flex; align-items: center; justify-content: center; gap: 10px; flex-wrap: wrap; margin-top: 10px;
}
.hvss-settings-dialog .af-templates .af-entry {
  display: grid; grid-template-columns: 1fr 3fr auto; gap: 6px; margin-bottom: 6px; align-items: center;
}
.hvss-settings-dialog .af-templates .af-entry input { width: 100%; min-width: 0; }
.hvss-settings-dialog .af-templates .af-single { width: 100%; }
.hvss-settings-dialog .af-templates .af-tdel,
.hvss-settings-dialog .hv-form-block #af_addTemplate { width: auto; }
.hvss-settings-dialog #accessLevels { width: 100%; table-layout: fixed; }
.hvss-settings-dialog .access-dialog-archive { margin: 8px 0; text-align: center; }
`;
    document.head.appendChild(style);
  }

  function createMaskAdmin(ctx) {
    const escapeHtml = ctx.escapeHtml;
    const escapeAttr = ctx.escapeAttr;

    const admin = {
      settings: ctx.settings,
      forums: ctx.forums.slice(),
      groups: mergeGroupsFromSettings(ctx.groups.slice(), ctx.settings),
      isManual: false,
      scriptFound: false,
      error: '',
      panel: ctx.panel,

      mount: async function () {
        injectMaskStyles();
        const status = await checkManual();
        this.scriptFound = status.scriptFound;
        this.isManual = status.isManual;
        this.error = status.error;
        if (status.detectedUserFields.length) {
          this.settings.userFields = status.detectedUserFields;
        }
        this.renderForm();
        this.addListeners();
        this.renderForums();
        this.renderChangelist();
        this.fillForm();
        this.renderNotes();
      },

      renderForm: function () {
        const div = document.createElement('div');
        div.className = 'hvwrapper';
        div.innerHTML = `<div id="hvmasknotes" class="notes"></div>
        <fieldset>
          <legend><span>Маска в форумах</span></legend>
          <div class="adfs-box">
            <p class="adinfofield">Администраторам и модераторам разрешения не требуются. Перетащите группы в нужный уровень доступа.</p>
            <table cellspacing="0" id="accessForm" class="adcontainer">
              <thead><tr>
                <th class="tcl" scope="col">Форум</th>
                <th class="tc2" scope="col">Маска</th>
                <th class="tc3 checker" scope="col">Действие</th>
              </tr></thead>
              <tbody></tbody>
            </table>
          </div>
        </fieldset>

        <fieldset>
          <legend><span>Свои поля профиля</span></legend>
          <div class="adfs-box">
            <p class="adinfofield">Ник, статус, аватар и подпись уже есть в скрипте. Здесь — дополнительные поля (например личные звания).</p>
            <table cellspacing="0" id="changelistForm" class="adcontainer">
              <thead><tr>
                <th class="tcl" scope="col">Поле</th>
                <th class="tc2" scope="col">Описание</th>
                <th class="tc3 checker" scope="col">Действие</th>
              </tr></thead>
              <tbody></tbody>
            </table>
            <p class="adinfofield">
              <input type="button" id="hv_addField" class="button" value="+ Добавить поле" />
            </p>
          </div>
        </fieldset>

        <fieldset>
          <legend><span>Кастомизация</span></legend>
          <div class="adfs-box">
            <p>
              <label class="adlabel" for="hv_maskLimit">Лимит хранилища масок</label>
              <span class="adinput"><input type="number" id="hv_maskLimit" min="1" max="100" /></span>
            </p>
            <p class="longinput">
              <label class="adlabel" for="hv_defaultAvatar">Аватар в предпросмотре по умолчанию</label>
              <span class="adinput">
                <input type="text" id="hv_defaultAvatar" placeholder="https://..." />
                <em>Предпросмотр: <img id="hv_defaultAvatarPreview" src="" alt="" /></em>
              </span>
            </p>
            <p class="longinput">
              <label class="adlabel" for="hv_defaultIcon">Изображение кнопки</label>
              <span class="adinput">
                <input type="text" id="hv_defaultIcon" placeholder="https://..." />
                <em>Предпросмотр: <img id="hv_defaultIconPreview" class="hv-btn-preview" src="" alt="" /></em>
              </span>
            </p>
            <p>
              <label class="adlabel" for="hv_showPreview">Превью маски в диалоге</label>
              <span class="adinput"><label><input type="checkbox" id="hv_showPreview" /> Показывать</label></span>
            </p>
            <p>
              <label class="adlabel" for="hv_disableQuote">Цитирование</label>
              <span class="adinput"><label><input type="checkbox" id="hv_disableQuote" /> Цитировать и отвечать с оригинальным именем профиля</label></span>
            </p>
          </div>
        </fieldset>

        <p class="submitend">
          <input type="button" id="hv_saveSettings" class="button" value="Сохранить" />
        </p>

  <div id="accessForumForm" class="hvss-settings-dialog" style="display:none">
    <div class="hv-bg">
      <div class="inner container">
        <div class="hv-mask-dialog-title">Доступы в форуме «<span id="accessForumFormTitle"></span>»</div>
        <table id="accessLevels">
          <thead>
            <tr>
              <th>Нет маски</th>
              <th>Только аватар</th>
              <th>Полный доступ</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td id="accessLevelDeny" class="access-drop-zone" data-level="deny"></td>
              <td id="accessLevelPart" class="access-drop-zone" data-level="part"></td>
              <td id="accessLevelFull" class="access-drop-zone" data-level="full"></td>
            </tr>
          </tbody>
        </table>
        <div class="access-dialog-archive">
          <label><input type="checkbox" id="accessForumArchive" /> Архив — маска видна у удалённых пользователей/гостей</label>
        </div>
        <div class="hv-control">
          <input type="button" id="accessForumFormCancel" class="button" value="Отмена" />
          <input type="button" id="accessForumFormSave" class="button" value="Сохранить" />
        </div>
      </div>
    </div>
  </div>

  <div id="editAdditionalFieldForm" class="hvss-settings-dialog" style="display:none">
    <div class="hv-bg">
      <div class="inner container">
        <div class="hv-mask-dialog-title" id="af_dialogTitle">Редактировать поле</div>
        <div class="hv-form-block">
          <div class="hv-mask-field">
            <label for="af_name"><b>Название</b></label>
            <input type="text" id="af_name" placeholder="Личное звание" />
          </div>
          <div class="hv-mask-field">
            <label for="af_class"><b>ID поля</b></label>
            <select id="af_class"></select>
          </div>
          <div class="hv-mask-field">
            <label for="af_tag"><b>BB-тэг</b></label>
            <input type="text" id="af_tag" placeholder="info" />
          </div>
          <div class="hv-mask-field">
            <label for="af_type"><b>Тип</b></label>
            <select id="af_type">
              <option value="html">html</option>
              <option value="bbcode">bbcode</option>
              <option value="text">text</option>
            </select>
          </div>
          <div class="hv-mask-field">
            <label for="af_description"><b>Пояснение</b></label>
            <input type="text" id="af_description" placeholder="Пояснение к полю" />
          </div>
          <div class="hv-mask-field">
            <label><b>Шаблоны</b></label>
            <div class="hv-description">Один или несколько шаблонов для быстрого заполнения.</div>
            <div id="af_templates" class="af-templates"></div>
            <input type="button" id="af_addTemplate" class="button" value="+ Добавить шаблон" />
          </div>
        </div>
        <div class="hv-control">
          <input type="button" id="af_deleteField" class="button button-danger" value="Удалить поле" />
          <input type="button" id="af_cancelField" class="button" value="Отмена" />
          <input type="button" id="af_saveField" class="button" value="Сохранить" />
        </div>
      </div>
    </div>
  </div>`;
        this.panel.innerHTML = '';
        this.panel.appendChild(div);
      },

      renderNotes: function () {
        const box = document.getElementById('hvmasknotes');
        if (!box) {
          return;
        }
        const notes = [];
        if (this.isManual) {
          notes.push(`<div class="hv-note hv-note-warn">
          <b>Конфликт настроек.</b> На форуме вызывается <code>hvScriptSet.addMask({...})</code> с объектом —
          настройки из storage <b>не применятся</b>, пока вызов не будет приведён к виду
          <code>hvScriptSet.addMask()</code> (без аргументов).
        </div>`);
        } else if (!this.scriptFound) {
          notes.push(`<div class="hv-note hv-note-error">
          <b>${escapeHtml(this.error || 'Скрипт маски не найден.')}</b>
          Добавьте в html-низ: <code>&lt;script src="https://forumstatic.ru/files/0017/95/29/89289.js"&gt;&lt;/script&gt;</code>
          и <code>&lt;script&gt;hvScriptSet.addMask();&lt;/script&gt;</code>.
        </div>`);
        }
        box.innerHTML = notes.join('');
      },

      resolveGroupAccessLevel: function (forumName, groupName) {
        const forumAccessExtended = this.settings.forumAccessExtended || {};
        if (Array.isArray(forumAccessExtended[forumName]) && forumAccessExtended[forumName].indexOf(groupName) !== -1) {
          return 'full';
        }
        const forumAccess = this.settings.forumAccess || {};
        if (Array.isArray(forumAccess[forumName]) && forumAccess[forumName].indexOf(groupName) !== -1) {
          return 'part';
        }
        return 'deny';
      },

      getForumGroupBuckets: function (forumName) {
        const fullAccess = [];
        const access = [];
        this.groups.forEach(group => {
          const level = this.resolveGroupAccessLevel(forumName, group.name);
          if (level === 'full') {
            fullAccess.push(group);
          } else if (level === 'part') {
            access.push(group);
          }
        });
        return { fullAccess, access };
      },

      renderForums: function () {
        const container = this.panel.querySelector('#accessForm tbody');
        if (!container) {
          return;
        }
        container.innerHTML = '';
        this.forums.forEach(item => {
          const guestAccess = Array.isArray(this.settings.guestAccess) ? this.settings.guestAccess : [];
          const isArchive = guestAccess.indexOf(item.name) !== -1;
          const buckets = this.getForumGroupBuckets(item.name);
          const html = `<tr class="forumitem" data-id="${escapeAttr(item.id)}">
          <td class="tcl"><b>${escapeHtml(item.name)}</b></td>
          <td class="tc2">
            ${isArchive ? '<span class="isarchive">[архив]</span>' : ''}
            ${buckets.fullAccess.length ? `<div>полный доступ: ${buckets.fullAccess.map(i => escapeHtml(i.name)).join(', ')}</div>` : ''}
            ${buckets.access.length ? `<div>аватар: ${buckets.access.map(i => escapeHtml(i.name)).join(', ')}</div>` : ''}
          </td>
          <td class="tc3 checker">
            <input type="button" class="button editForumAccess" data-id="${escapeAttr(item.id)}" value="✎" title="Редактировать" />
          </td>
        </tr>`;
          container.insertAdjacentHTML('beforeend', html);
        });
      },

      renderChangelist: function () {
        const container = this.panel.querySelector('#changelistForm tbody');
        if (!container) {
          return;
        }
        container.innerHTML = '';
        const entries = Object.keys(this.settings.changeList || {}).map(key => [key, this.settings.changeList[key]]);
        if (!entries.length) {
          container.innerHTML = '<tr><td class="tcl" colspan="3">Дополнительных полей нет</td></tr>';
          return;
        }
        const tagCounts = {};
        entries.forEach(pair => {
          const item = pair[1];
          const tag = sanitizeBbTag((item.tag || '').split(',')[0] || '');
          if (tag) {
            tagCounts[tag] = (tagCounts[tag] || 0) + 1;
          }
        });
        entries.forEach(pair => {
          const key = pair[0];
          const item = pair[1];
          const templates = this._afGetTemplates(item.defaultCode);
          const tempCount = templates.filter(t => (t.template || '').trim()).length;
          const mainTag = sanitizeBbTag((item.tag || '').split(',')[0] || '');
          const dup = mainTag && tagCounts[mainTag] > 1
            ? '<div class="hv-dup-tag">BB-тэг должен быть уникальным</div>'
            : '';
          const badTemplates = (item.type || 'html') === 'html'
            ? templates
              .map((t, index) => ({ name: t.name || `№${index + 1}`, reason: getHtmlViolation(t.template) }))
              .filter(t => t.reason)
              .map(t => `<div class="hv-dup-tag">Шаблон «${escapeHtml(t.name)}»: ${escapeHtml(t.reason)}</div>`)
              .join('')
            : '';
          const desc = item.description ? `<div>${escapeHtml(item.description)}</div>` : '';
          const html = `<tr class="fielditem" data-id="${escapeAttr(key)}">
          <td class="tcl">
            <div class="tclcon">
              <b>${escapeHtml(item.title || key)}</b> • <span>${escapeHtml(item.class || key)}</span><br />
              [${escapeHtml(item.tag || '')}] ${escapeHtml(item.type || 'html')}
              ${dup}
              ${badTemplates}
            </div>
          </td>
          <td class="tc2">
            ${desc}
            <div>Шаблоны: ${tempCount}</div>
          </td>
          <td class="tc3 checker">
            <input type="button" class="button editAdditionalField" value="✎" title="Редактировать" />
          </td>
        </tr>`;
          container.insertAdjacentHTML('beforeend', html);
        });
      },

      fillForm: function () {
        document.getElementById('hv_defaultIcon').value = this.settings.buttonImage || '';
        document.getElementById('hv_defaultAvatar').value = this.settings.defaultAvatar || '';
        document.getElementById('hv_maskLimit').value = this.settings.maskLimit || 20;
        document.getElementById('hv_disableQuote').checked = Boolean(this.settings.disableQuote);
        document.getElementById('hv_showPreview').checked = this.settings.showPreview !== false;
        this.syncButtonPreview();
        this.syncAvatarPreview();
      },

      syncButtonPreview: function () {
        const preview = document.getElementById('hv_defaultIconPreview');
        const input = document.getElementById('hv_defaultIcon');
        if (!preview || !input) {
          return;
        }
        preview.src = input.value.trim() || DEFAULT_SETTINGS.buttonImage;
      },

      syncAvatarPreview: function () {
        const preview = document.getElementById('hv_defaultAvatarPreview');
        const input = document.getElementById('hv_defaultAvatar');
        if (!preview || !input) {
          return;
        }
        preview.src = input.value.trim() || DEFAULT_SETTINGS.defaultAvatar;
      },

      collectFormSettings: function () {
        const maskLimit = Math.max(1, Math.min(100, parseInt(document.getElementById('hv_maskLimit').value, 10) || 20));
        const buttonImage = document.getElementById('hv_defaultIcon').value.trim();
        const defaultAvatar = document.getElementById('hv_defaultAvatar').value.trim();
        const userFields = Array.isArray(this.settings.userFields) && this.settings.userFields.length
          ? this.settings.userFields.slice()
          : DEFAULT_SETTINGS.userFields.slice();
        Object.keys(this.settings.changeList || {}).forEach(key => {
          const item = this.settings.changeList[key];
          const fieldClass = item && item.class;
          if (fieldClass && userFields.indexOf(fieldClass) === -1) {
            userFields.push(fieldClass);
          }
        });
        return {
          maskLimit,
          buttonImage: buttonImage || DEFAULT_SETTINGS.buttonImage,
          defaultAvatar: defaultAvatar || DEFAULT_SETTINGS.defaultAvatar,
          userFields,
          disableQuote: document.getElementById('hv_disableQuote').checked,
          showPreview: document.getElementById('hv_showPreview').checked,
          guestAccess: Array.isArray(this.settings.guestAccess) ? this.settings.guestAccess : [],
          forumAccess: this.settings.forumAccess || {},
          forumAccessExtended: this.settings.forumAccessExtended || {},
          changeList: this.settings.changeList || {},
        };
      },

      addListeners: function () {
        document.getElementById('accessForm').addEventListener('click', this.accessFormClick.bind(this));
        document.getElementById('changelistForm').addEventListener('click', this.changelistFormClick.bind(this));
        document.getElementById('accessForumFormCancel').addEventListener('click', () => {
          this.closeDialog('accessForumForm');
        });
        document.getElementById('accessForumFormSave').addEventListener('click', () => {
          this.saveForumAccess();
        });
        document.getElementById('hv_saveSettings').addEventListener('click', () => {
          this.saveSettings();
        });
        document.getElementById('hv_defaultIcon').addEventListener('input', this.syncButtonPreview.bind(this));
        document.getElementById('hv_defaultAvatar').addEventListener('input', this.syncAvatarPreview.bind(this));
        document.getElementById('hv_addField').addEventListener('click', () => {
          this.editAdditionalFieldForm('');
        });
        this.bindDialogChrome('accessForumForm');
        this.bindDialogChrome('editAdditionalFieldForm');
        if (!admin._escBound) {
          admin._escBound = true;
          document.addEventListener('keydown', e => {
            if (e.key === 'Escape' || e.keyCode === 27) {
              this.closeDialog('accessForumForm');
              this.closeDialog('editAdditionalFieldForm');
            }
          });
        }
      },

      bindDialogChrome: function (id) {
        const root = document.getElementById(id);
        if (!root) {
          return;
        }
        const bg = root.querySelector('.hv-bg');
        if (!bg || bg.dataset.bound) {
          return;
        }
        bg.dataset.bound = '1';
        bg.addEventListener('click', event => {
          if (event.target === bg) {
            this.closeDialog(id);
          }
        });
      },

      openDialog: function (id) {
        const root = document.getElementById(id);
        if (root) {
          root.style.display = 'block';
        }
      },

      closeDialog: function (id) {
        const root = document.getElementById(id);
        if (root) {
          root.style.display = 'none';
        }
      },

      accessFormClick: function (event) {
        const target = event.target;
        if (target.classList.contains('editForumAccess')) {
          const id = target.dataset.id;
          const forum = this.forums.find(item => String(item.id) === String(id));
          if (forum) {
            this.accessForumForm(forum);
          }
        }
      },

      accessForumForm: function (forum) {
        const dialog = document.getElementById('accessForumForm');
        dialog.querySelector('#accessForumFormTitle').textContent = forum.name;
        dialog.dataset.forumName = forum.name;
        const deny = document.getElementById('accessLevelDeny');
        const part = document.getElementById('accessLevelPart');
        const full = document.getElementById('accessLevelFull');
        deny.innerHTML = '';
        part.innerHTML = '';
        full.innerHTML = '';
        this.groups.forEach(group => {
          const level = this.resolveGroupAccessLevel(forum.name, group.name);
          const chip = this.createGroupChip(group);
          if (level === 'full') {
            full.appendChild(chip);
          } else if (level === 'part') {
            part.appendChild(chip);
          } else {
            deny.appendChild(chip);
          }
        });
        [deny, part, full].forEach(zone => {
          zone.ondragover = e => {
            e.preventDefault();
            zone.classList.add('drag-over');
          };
          zone.ondragleave = () => {
            zone.classList.remove('drag-over');
          };
          zone.ondrop = e => {
            e.preventDefault();
            zone.classList.remove('drag-over');
            const groupId = e.dataTransfer.getData('text/plain');
            const chip = dialog.querySelector('.access-group-chip[data-id="' + groupId + '"]');
            if (chip) {
              zone.appendChild(chip);
            }
          };
        });
        const guestAccess = Array.isArray(this.settings.guestAccess) ? this.settings.guestAccess : [];
        document.getElementById('accessForumArchive').checked = guestAccess.indexOf(forum.name) !== -1;
        this.openDialog('accessForumForm');
      },

      createGroupChip: function (group) {
        const chip = document.createElement('div');
        chip.className = 'access-group-chip';
        chip.draggable = true;
        chip.dataset.id = group.id;
        chip.dataset.name = group.name;
        chip.textContent = group.name;
        chip.addEventListener('dragstart', e => {
          e.dataTransfer.setData('text/plain', group.id);
          chip.classList.add('dragging');
        });
        chip.addEventListener('dragend', () => {
          chip.classList.remove('dragging');
        });
        return chip;
      },

      saveForumAccess: function () {
        const dialog = document.getElementById('accessForumForm');
        const forumName = dialog.dataset.forumName;
        if (!forumName) {
          return;
        }
        const partChips = Array.prototype.slice.call(
          document.getElementById('accessLevelPart').querySelectorAll('.access-group-chip')
        );
        const fullChips = Array.prototype.slice.call(
          document.getElementById('accessLevelFull').querySelectorAll('.access-group-chip')
        );
        if (!this.settings.forumAccess) {
          this.settings.forumAccess = {};
        }
        if (!this.settings.forumAccessExtended) {
          this.settings.forumAccessExtended = {};
        }
        const part = partChips.map(c => c.dataset.name);
        const full = fullChips.map(c => c.dataset.name);
        if (part.length) {
          this.settings.forumAccess[forumName] = part;
        } else {
          delete this.settings.forumAccess[forumName];
        }
        if (full.length) {
          this.settings.forumAccessExtended[forumName] = full;
        } else {
          delete this.settings.forumAccessExtended[forumName];
        }
        const isArchive = document.getElementById('accessForumArchive').checked;
        const guestAccess = Array.isArray(this.settings.guestAccess) ? this.settings.guestAccess.slice() : [];
        const idx = guestAccess.indexOf(forumName);
        if (isArchive && idx === -1) {
          guestAccess.push(forumName);
        } else if (!isArchive && idx !== -1) {
          guestAccess.splice(idx, 1);
        }
        this.settings.guestAccess = guestAccess;
        this.closeDialog('accessForumForm');
        this.renderForums();
      },

      changelistFormClick: function (event) {
        const target = event.target;
        if (target.classList.contains('editAdditionalField')) {
          const key = target.closest('tr').dataset.id;
          this.editAdditionalFieldForm(key);
        }
      },

      editAdditionalFieldForm: function (key) {
        const dialog = document.getElementById('editAdditionalFieldForm');
        const isNew = !key;
        const item = (!isNew && this.settings.changeList[key]) || {};
        dialog.dataset.fieldKey = key || '';
        document.getElementById('af_dialogTitle').textContent = isNew ? 'Новое поле' : 'Редактировать поле';
        document.getElementById('af_name').value = item.title || '';
        const classSelect = document.getElementById('af_class');
        const usedClasses = {};
        Object.keys(this.settings.changeList || {}).forEach(k => {
          if (k === key) {
            return;
          }
          const v = this.settings.changeList[k];
          const cls = (v && v.class) || k;
          if (cls) {
            usedClasses[cls] = true;
          }
        });
        const currentClass = item.class || key || '';
        let preferred = '';
        for (let i = 0; i < PA_FLD_OPTIONS.length; i++) {
          if (!usedClasses[PA_FLD_OPTIONS[i]]) {
            preferred = PA_FLD_OPTIONS[i];
            break;
          }
        }
        classSelect.innerHTML = PA_FLD_OPTIONS.map(f => {
          const selected = f === (currentClass || preferred) ? ' selected' : '';
          const disabled = usedClasses[f] ? ' disabled' : '';
          return '<option value="' + f + '"' + selected + disabled + '>' + f + '</option>';
        }).join('');
        document.getElementById('af_tag').value = item.tag || '';
        const typeSelect = document.getElementById('af_type');
        const type = item.type === 'bbtag' ? 'bbcode' : (item.type || 'html');
        typeSelect.value = ['html', 'bbcode', 'text'].indexOf(type) !== -1 ? type : 'html';
        document.getElementById('af_description').value = item.description || '';
        this._afRenderTemplates(this._afGetTemplates(item.defaultCode));
        document.getElementById('af_templates').oninput = () => this._afValidateTemplates();
        typeSelect.onchange = () => this._afValidateTemplates();

        document.getElementById('af_addTemplate').onclick = () => {
          const container = document.getElementById('af_templates');
          if (!container.querySelector('.af-entry')) {
            const singleInput = container.querySelector('.af-single');
            const currentCode = singleInput ? singleInput.value : '';
            container.innerHTML = '';
            [{ name: '', template: currentCode }, { name: '', template: '' }].forEach(t => {
              container.appendChild(this._afCreateEntry(t));
            });
          } else {
            container.appendChild(this._afCreateEntry({ name: '', template: '' }));
          }
          this._afValidateTemplates();
        };
        document.getElementById('af_cancelField').onclick = () => this.closeDialog('editAdditionalFieldForm');
        document.getElementById('af_deleteField').style.display = isNew ? 'none' : '';
        document.getElementById('af_deleteField').onclick = () => {
          if (!key) {
            return;
          }
          if (confirm('Удалить поле «' + (item.title || key) + '»?')) {
            delete this.settings.changeList[key];
            this.closeDialog('editAdditionalFieldForm');
            this.renderChangelist();
          }
        };
        document.getElementById('af_saveField').onclick = () => {
          const title = document.getElementById('af_name').value.trim();
          const fieldClass = document.getElementById('af_class').value;
          const tag = sanitizeBbTag(document.getElementById('af_tag').value);
          const typeValue = document.getElementById('af_type').value;
          if (!title || !fieldClass || !tag) {
            $.jGrowl('Заполните название, ID поля и BB-тэг');
            return;
          }
          const dupTag = Object.keys(this.settings.changeList || {}).some(k => {
            if (k === key) {
              return false;
            }
            const v = this.settings.changeList[k];
            const other = sanitizeBbTag(((v && v.tag) || '').split(',')[0] || '');
            return other && other === tag;
          });
          if (dupTag) {
            $.jGrowl('BB-тэг должен быть уникальным');
            return;
          }
          const container = document.getElementById('af_templates');
          let defaultCode;
          if (container.querySelector('.af-entry')) {
            const list = Array.prototype.slice.call(container.querySelectorAll('.af-entry')).map(e => ({
              name: e.querySelector('.af-tname').value.trim(),
              template: e.querySelector('.af-tcode').value,
            })).filter(t => t.template.trim());
            if (list.length === 0) {
              defaultCode = '';
            } else if (list.length === 1) {
              defaultCode = list[0].template;
            } else {
              defaultCode = list;
            }
          } else {
            const s = container.querySelector('.af-single');
            defaultCode = s ? s.value : '';
          }
          const badTemplates = this._afValidateTemplates();
          if (badTemplates.length) {
            $.jGrowl('Шаблон не пройдёт проверку безопасности маски:' + badTemplates
              .map(t => `<br />• «${escapeHtml(t.name)}»: ${escapeHtml(t.reason)}`)
              .join(''));
            return;
          }
          const fieldKey = fieldClass;
          if (key && key !== fieldKey && this.settings.changeList[key]) {
            delete this.settings.changeList[key];
          }
          this.settings.changeList[fieldKey] = {
            title,
            class: fieldClass,
            tag,
            type: typeValue,
            description: document.getElementById('af_description').value.trim(),
          };
          if (defaultCode) {
            this.settings.changeList[fieldKey].defaultCode = defaultCode;
          }
          this.closeDialog('editAdditionalFieldForm');
          this.renderChangelist();
        };
        this.openDialog('editAdditionalFieldForm');
      },

      _afGetTemplates: function (defaultCode) {
        if (Array.isArray(defaultCode)) {
          return defaultCode.map(item => {
            if (typeof item === 'string') {
              return { name: '', template: item };
            }
            return {
              name: item.name || item.title || '',
              template: item.template || item.code || '',
            };
          });
        }
        if (defaultCode) {
          return [{ name: '', template: String(defaultCode) }];
        }
        return [];
      },

      _afRenderTemplates: function (templates) {
        const container = document.getElementById('af_templates');
        container.innerHTML = '';
        if (templates.length <= 1) {
          const input = document.createElement('input');
          input.type = 'text';
          input.className = 'af-single';
          input.placeholder = 'шаблон';
          input.value = templates.length === 1 ? (templates[0].template || '') : '';
          container.appendChild(input);
        } else {
          templates.forEach(t => container.appendChild(this._afCreateEntry(t)));
        }
        this._afValidateTemplates();
      },

      _afValidateTemplates: function () {
        const container = document.getElementById('af_templates');
        const isHtml = document.getElementById('af_type').value === 'html';
        const bad = [];
        container.querySelectorAll('.af-violation').forEach(el => el.remove());
        container.querySelectorAll('.af-single, .af-tcode').forEach((input, index) => {
          const reason = isHtml ? getHtmlViolation(input.value) : '';
          input.classList.toggle('af-invalid', Boolean(reason));
          if (!reason) {
            return;
          }
          const entry = input.closest('.af-entry');
          const name = (entry && entry.querySelector('.af-tname').value.trim()) || `№${index + 1}`;
          bad.push({ name, reason });
          const note = document.createElement('div');
          note.className = 'af-violation';
          note.textContent = reason;
          (entry || input).insertAdjacentElement(entry ? 'beforeend' : 'afterend', note);
        });
        return bad;
      },

      _afCreateEntry: function (tpl) {
        const div = document.createElement('div');
        div.className = 'af-entry';
        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'af-tname';
        nameInput.placeholder = 'название шаблона';
        nameInput.value = tpl.name || '';
        const codeInput = document.createElement('input');
        codeInput.type = 'text';
        codeInput.className = 'af-tcode';
        codeInput.placeholder = 'шаблон';
        codeInput.value = tpl.template || '';
        const delBtn = document.createElement('input');
        delBtn.type = 'button';
        delBtn.className = 'button af-tdel';
        delBtn.value = '✕';
        delBtn.addEventListener('click', () => {
          div.remove();
          const container = document.getElementById('af_templates');
          const entries = container.querySelectorAll('.af-entry');
          if (entries.length === 1) {
            const lastCode = entries[0].querySelector('.af-tcode').value;
            this._afRenderTemplates([{ name: '', template: lastCode }]);
          } else if (entries.length === 0) {
            this._afRenderTemplates([]);
          } else {
            this._afValidateTemplates();
          }
        });
        div.appendChild(nameInput);
        div.appendChild(codeInput);
        div.appendChild(delBtn);
        return div;
      },

      saveSettings: async function () {
        const settings = this.collectFormSettings();
        this.settings = settings;
        try {
          await ctx.save(buildStoragePayload(settings));
          if (this.isManual) {
            $.jGrowl('Внимание: на форуме ручной addMask({...}) — storage пока не применится');
          }
        } catch (e) {
          $.jGrowl(e.message || 'Ошибка сохранения');
          console.error(e);
        }
      },
    };

    return admin;
  }

  const formDef = {
    id: FORM_ID,
    title: 'Маска профиля',
    storageKey: STORAGE_KEY,
    defaults: DEFAULT_SETTINGS,
    normalize: function (stored, defaults) {
      return normalizeSettings(stored, defaults);
    },
    render: async function (panel, ctx) {
      const admin = createMaskAdmin(ctx);
      await admin.mount();
    },
  };

  window.HvScriptManager = window.HvScriptManager || [];
  HvScriptManager.push(formDef);
})();
