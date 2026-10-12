"use strict";

/**
 * hvScriptSet
 * Version: 1.2.0
 * Author: Человек-Шаман
 * license: MIT
 *
 * Что нового:
 * 1. Новый интерфейс: предпросмотр у кнопки отправки и меню масок вместо мини-аватара.
 * 2. Редактор маски с превью в стилях форума и загрузкой аватара в «Мои загрузки».
 * 3. Можно скрыть подпись в посте.
 * 4. Интерфейс берёт кнопки, поля и цвета у форума.
 */

const hvScriptSet = {

  version: '1.2.0',

  data: {},

  addMask: async function (options) {
    const opt = options || await getMaskSettings();

    if (!opt) {
      console.error('Настройки скрипта маски не определены');
      return;
    }

    const HVSS_URLS = {
      style: 'https://forumstatic.ru/files/0017/95/29/92410.css',
      defaultAvatar: 'https://i.imgur.com/bQuC3S1.png',
      buttonImage: 'https://i.imgur.com/ONu0llO.png',
      blankImage: '/i/blank.gif',
      api: '/api.php',
      upload: '/upload',
    };

    const that = this;

    const changeList = {
      'author': {
        title: 'Ник',
        description: 'Только текст',
        tag: 'nick,nic',
        class: 'pa-author',
        type: 'link'
      },
      'title': {
        title: 'Статус',
        description: 'Только текст',
        tag: 'status,sta',
        class: 'pa-title',
        type: 'text'
      },
      'avatar': {
        title: 'Аватар',
        description: 'Прямая ссылка на картинку jpg, gif, png или webp',
        tag: 'icon,ava',
        class: 'pa-avatar',
        type: 'avatar'
      },
      'signature': {
        title: 'Подпись',
        description: 'Принимает bb-коды, кроме таблицы',
        tag: 'sign,sgn',
        class: 'post-sig',
        type: 'signature'
      },
      ...opt.changeList
    };
    that.data.changeList = changeList;

    if (window.GroupID === 1 && options) {
      saveMaskSettings(opt);
    }

    const NO_SIGNATURE = '[hidesig]';
    const MOBILE_QUERY = '(max-width: 640px)';
    const ICONS = {
      pin: '<svg class="hv-icon" viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" d="M9 3h6l-1 6 3 3v2H7v-2l3-3z"/><path d="M12 14v7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
      code: '<svg class="hv-icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M9 7l-5 5 5 5M15 7l5 5-5 5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      caretUp: '<svg class="hv-icon" viewBox="0 0 24 24" width="10" height="10" aria-hidden="true"><path d="M6 15l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      caretDown: '<svg class="hv-icon" viewBox="0 0 24 24" width="10" height="10" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    };

    let tmpMask = {};
    let previewForm = null;
    let responseMessageField = null;
    let dialogMaskSnapshot = {};
    let maskButton = null;
    let topicPinned = false;
    let errorList = {};
    let persistOnSubmit = true;
    let editorOriginalMask = null;
    const ui = {
      layer: null,
      shade: null,
      popover: null,
      menu: null,
      chip: null,
      anchor: null,
      open: false,
      dialogInner: null,
      dialogTitle: null,
      saveCheckbox: null,
      avatarStatus: null,
      globalBind: false
    };

    const userFields = opt.userFields || ['pa-author', 'pa-title', 'pa-avatar', 'pa-fld1', 'pa-reg',
      'pa-posts', 'pa-respect', 'pa-positive', 'pa-awards', 'pa-gifts'];
    const allTagsList = getTagList();

    const defaultAvatar = opt.defaultAvatar || HVSS_URLS.defaultAvatar;

    const maskLimit = opt.maskLimit || 20;

    const canQuoteMask = !opt.disableQuote;
    const topicMaskStorageKey = `hvssTopicMasksByTopicId:${window.UserID || 'guest'}`;

    const MASK_SPLIT_KEY = '|splitKey|';
    const STORAGE_LIMIT = 65500;
    const storageState = { lastRead: null, lastWrite: null, errors: [] };

    let prevMasks = [];

    getStorageMask();
    setupDebugData();

    let posts = [];

    // Вставляет поле профиля перед ближайшим следующим по userFields, иначе в конец.
    function insertProfileField(profile, fieldClass, node) {
      const position = userFields.indexOf(fieldClass);
      const next = position === -1 ? null : userFields.slice(position + 1)
        .map(name => profile.querySelector('.' + name)).find(Boolean);
      if (next) {
        next.parentNode.insertBefore(node, next);
      } else {
        profile.appendChild(node);
      }
    }

    function getForumPosts() {
      return Array.from(document.querySelectorAll('.post'))
        .filter(post => !post.closest('#mask_dialog') && post.querySelector('.post-content'));
    }

    function getPosts() {
      posts = getForumPosts();
      let changedPosts = {};
      let changedUsersId = [];
      for (let i = 0; i < posts.length; i++) {
        const postEl = posts[i].querySelector('.post-content');
        const postId = posts[i].getAttribute('id');
        const postProfile = posts[i].querySelector('.post-author ul');
        const postText = postEl.innerHTML;
        const postSignature = posts[i].querySelector('.post-sig dd');
        const postChangeList = getTags(postText);
        const userId = posts[i].dataset.userId;

        if (Object.keys(postChangeList).length !== 0) {
          changedPosts[i] = {
            postId: postId,
            userId: userId,
            text: postEl,
            clearedText: getClearedPost(postEl, postChangeList),
            profile: postProfile,
            changeList: postChangeList,
            signature: postSignature
          };
          if (!(changedUsersId.indexOf(userId) + 1)) {
            changedUsersId.push(userId);
          }
        }
      }
      let checkAccess = changedUsersId.length > 0 ? getAccess(changedUsersId) : {};

      that.data.changedPosts = changedPosts;

      for (let _i in changedPosts) {
        if (changedPosts.hasOwnProperty(_i)) {
          const userInfo = checkAccess[changedPosts[_i].userId];
          if (!userInfo) {
            delete changedPosts[_i];
            continue;
          }
          changedPosts[_i].username = userInfo.username;
          changedPosts[_i].groupId = userInfo.groupId;
          changedPosts[_i].groupTitle = userInfo.groupTitle;
          changedPosts[_i].access = userInfo.access;

          if (changedPosts[_i].changeList.avatar && changedPosts[_i].access.common) {
            if (!changedPosts[_i].profile.querySelector('.pa-avatar img')) {
              const block = el('li', { className: 'pa-avatar' }, [
                el('img', { src: '', title: changedPosts[_i].username })
              ]);
              insertProfileField(changedPosts[_i].profile, 'pa-avatar', block);
            }
            let avatar = changedPosts[_i].profile.querySelector(`.pa-avatar img[title]`)
              || changedPosts[_i].profile.querySelector(`.pa-avatar img[alt]`)
              || changedPosts[_i].profile.querySelector(`.pa-avatar img`);
            avatar.src = changedPosts[_i].changeList.avatar.content;
            avatar.removeAttribute('width');
            avatar.removeAttribute('height');
          }
        }
        if (changedPosts.hasOwnProperty(_i) && changedPosts[_i].access.extended) {
          let thisChanges = changedPosts[_i].changeList;
          for (let change in thisChanges) {
            if (thisChanges.hasOwnProperty(change)) {
              if (thisChanges[change].field === 'pa-author' && changedPosts[_i].userId === '1') {
                changedPosts[_i].changeList[change].type = 'text';
              }
              if (change !== 'signature' && !changedPosts[_i].profile.getElementsByClassName(changedPosts[_i]
                .changeList[change].field)[0]) {
                insertProfileField(changedPosts[_i].profile, thisChanges[change].field,
                  el('li', { className: thisChanges[change].field }));
              }
              let fieldEl = changedPosts[_i].profile.getElementsByClassName(changedPosts[_i]
                .changeList[change].field)[0];
              switch (changedPosts[_i].changeList[change].type) {
                case 'html':
                  let content = truncateText(unescapePostHtml(changedPosts[_i].changeList[change].content), 999);
                  const violation = setSafeHtml(fieldEl, content);
                  if (violation) {
                    console.error(`Что-то не так с маской в посте #${changedPosts[_i].postId}`);
                    if (window.GroupID === 1 || window.GroupID === 2) {
                      $.jGrowl(`Что-то не так с маской в посте <a href="#${changedPosts[_i].postId}">#${changedPosts[_i].postId}</a>: ${escapeHtml(violation)}.<br>Пост подсвечен красным. Подозрительный код скрыт.<br><i>Сообщение показано только администрации.</i>`, {
                        header: 'Маска профиля',
                        sticky: true
                      });
                      document.getElementById(changedPosts[_i].postId)
                          .style.border = 'solid 1px #f00';
                    }
                  }
                  break;
                case 'bbcode':
                  let __content = changedPosts[_i].changeList[change].content;
                  fieldEl.innerHTML = __content.length > 999 ? __content.slice(0, 999) : __content;
                  break;
                case 'text':
                  let _content = htmlToText(changedPosts[_i].changeList[change].content);
                  switch (change) {
                    case 'author':
                      _content = truncateText(_content, 25);
                      fieldEl.textContent = _content;
                      if (!canQuoteMask) break;
                      $(`#${changedPosts[_i].postId}`).find('.pl-quote a').attr('href', `javascript:quote(${toJsUrlString(_content)}, ${changedPosts[_i].postId.slice(1)})`);
                      break;
                    case 'title':
                      fieldEl.textContent = truncateText(_content, 50);
                      break;
                    default:
                      fieldEl.textContent = truncateText(_content, 999);
                  }
                  break;
                case 'link':
                  var linkContent = truncateText(htmlToText(changedPosts[_i].changeList[change].content), 25);
                  const nickLink = fieldEl.querySelector('a');
                  if (!nickLink) {
                    fieldEl.textContent = linkContent;
                    break;
                  }
                  nickLink.textContent = linkContent;

                  if (change === 'author' && canQuoteMask) {
                    nickLink.href = nickLink.href.includes('profile')
                      ? nickLink.href
                      : `javascript:to(${toJsUrlString(linkContent)})`;
                    $('#' + changedPosts[_i].postId).find('.pl-quote a').attr('href', `javascript:quote(${toJsUrlString(linkContent)}, ${changedPosts[_i].postId.slice(1)})`);
                  }
                  break;
                case 'signature':
                  if (htmlToText(changedPosts[_i].changeList[change].content).trim() === NO_SIGNATURE) {
                    const sigBlock = changedPosts[_i].signature && changedPosts[_i].signature.closest('.post-sig');
                    if (sigBlock) {
                      sigBlock.remove();
                    }
                    changedPosts[_i].signature = null;
                    break;
                  }
                  if (window.GroupID !== 3) {
                    if (!changedPosts[_i].signature) {
                      let signEl = document.createElement('dl');
                      signEl.className = 'post-sig';
                      signEl.innerHTML = `
                        <dl class="post-sig">
                          <dt>
                            <span>Подпись автора</span>
                          </dt>
                          <dd></dd>
                        </dl>`;
                      changedPosts[_i].text.appendChild(signEl);
                      changedPosts[_i].signature = signEl.querySelector('.post-sig dd');
                    }
                    changedPosts[_i].signature.innerHTML = changedPosts[_i].changeList[change].content;
                  }
                  break;
              }
            }
          }
        }
        let sign = changedPosts[_i].text.innerHTML.match(/<dl class="post-sig">([\s\S]*?)?<\/dl>/);
        changedPosts[_i].profile.classList.add('hv-mask');

        const hiddenHvBlock = changedPosts[_i].text.querySelector('.hvmask');
        if (!hiddenHvBlock) {
          changedPosts[_i].text.innerHTML = changedPosts[_i].clearedText + (sign ? sign[0] : '');
        }
      }
    }

    function hideTags() {
      posts = getForumPosts();
      posts.forEach(post => {
        const hiddenBlock = post.querySelector('.hvmask');
        if (hiddenBlock) return;
        const text = post.querySelector('.post-content');
        let html = text.innerHTML;
        allTagsList.forEach(tag => {
          const escaped = escapeRegExp(tag);
          html = html.replace(new RegExp('\\[' + escaped + '\\]([\\s\\S]*?)\\[\\/' + escaped + '\\]', 'gi'), '');
        });
        if (html !== text.innerHTML) text.innerHTML = html;
      })
    }

    function hidePreviewTags() {
      const text = document.querySelector('#post-preview .post-content')
      if (!text) return;
      const hiddenBlock = text.querySelector('.hvmask');
      if (hiddenBlock) return;
      const tags = getTags(text.innerHTML);
      if (Object.keys(tags).length) {
        text.innerHTML = getClearedPost(text, tags);
      }
    }

    function getTags(text) {
      let postChangeList = {};
      let clearedText = text.replace(/<div class="code-box"><strong class="legend">([\s\S]*?)?<\/strong><div class="blockcode"><div class="scrollbox" style="(?:.*?)"><pre>([\s\S]*?)?<\/pre><\/div><\/div><\/div>/gi, '');
      Object.keys(changeList).forEach(field => {
        const tags = changeList[field].tag.split(',');
        for (let i = tags.length - 1; i >= 0; i--) {
          const tag = escapeRegExp(tags[i]);
          const matches = clearedText.match(new RegExp('\\[' + tag + '\\]([\\s\\S]*?)\\[\\/' + tag + '\\]', 'gmi'));
          if (matches) {
            postChangeList[field] = {
              'tag': tags[i],
              'field': changeList[field].class,
              'content': matches[0].replace(new RegExp('\\[(\\/?)' + tag + '\\]', 'gmi'), ''),
              'type': changeList[field].type
            };
          }
        }
      });
      return postChangeList;
    }

    function getTagList() {
      const tagList = [];
      Object.values(changeList).forEach(item => {
        item.tag.split(',').forEach(tag => {
          if (!tagList.includes(tag)) tagList.push(tag);
        });
      });
      return tagList;
    }

    function getAccess(usersId) {
      let userInfo = getUsersInfo(usersId);
      const forumName = getClearedForumName(window.FORUM.topic.forum_name);
      for (let id in userInfo) {
        if (userInfo.hasOwnProperty(id)) {
          switch (userInfo[id].groupId) {
            case '1':
            case '2':
              userInfo[id].access = {
                'common': true,
                'extended': true
              };
              break;
            case '3':
              userInfo[id].access = {
                'common': opt.guestAccess ?
                  opt.guestAccess.includes(forumName) : false,
                'extended': opt.guestAccess ?
                  opt.guestAccess.includes(forumName) : false
              };
              break;
            default:
              const isCommonAccess = opt.forumAccess && opt.forumAccess[forumName]
                ? opt.forumAccess[forumName].includes(userInfo[id].groupTitle)
                : true
              const isExtendedAccess = opt.forumAccessExtended && opt.forumAccessExtended[forumName]
                ? opt.forumAccessExtended[forumName].includes(userInfo[id].groupTitle)
                : false
              userInfo[id].access = {
                'common': isExtendedAccess || isCommonAccess,
                'extended': isExtendedAccess
              };
          }
        }
      }
      return userInfo;
    }

    function getUsersInfo(usersId) {
      let usersIdStr = usersId.filter(item => +item > 1).join(',');
      let usersInfo = {};
      if (usersId.includes('1')) {
        usersInfo['1'] = {
          'userId': '1',
          'username': 'Guest',
          'groupId': '3',
          'groupTitle': 'Гость'
        };
      }
      if (usersIdStr) {
        $.ajax({
          async: false,
          url: HVSS_URLS.api,
          data: {
            method: 'users.get',
            user_id: usersIdStr
          },
          success: function success(json) {
            for (let i in json.response.users) {
              if (json.response.users.hasOwnProperty(i)) {
                usersInfo[json.response.users[i].user_id] = {
                  'userId': String(json.response.users[i].user_id),
                  'username': json.response.users[i].username,
                  'groupId': json.response.users[i].group_id,
                  'groupTitle': json.response.users[i].group_title
                };
              }
            }
          }
        });
      }

      return usersInfo;
    }

    function getAvatar() {
      return window.UserAvatar ? window.UserAvatar : defaultAvatar;
    }

    function getUserTitle() {
      return window.UserTitle ? window.UserTitle : 'Статус';
    }

    // Хранилище форума работает в windows-1251: символы вне этой кодировки (эмодзи, ∅, ✦…)
    // кодируются, иначе они пропадают при сохранении.
    const CP1251_CHARS = (function () {
      try {
        const bytes = new Uint8Array(128).map((_, index) => index + 128);
        return new Set(Array.from(new TextDecoder('windows-1251').decode(bytes)));
      } catch (e) {
        return null;
      }
    })();

    function encodeMaskStorage(masks) {
      return masks.join(MASK_SPLIT_KEY)
        .replace(/%/g, '%25')
        .replace(/[^\u0000-\u007F]/gu, ch => {
          if (ch.length > 1) return encodeURIComponent(ch);
          return !CP1251_CHARS || CP1251_CHARS.has(ch) ? ch : encodeURIComponent(ch);
        });
    }

    function notifyMaskError(text, options = {}) {
      if (options.updateUi) {
        errorList.common = text;
        showErrors();
      } else {
        $.jGrowl(text);
      }
    }

    function recordStorageOp(kind, info) {
      const entry = Object.assign({ time: new Date().toISOString() }, info);
      if (kind) storageState[kind] = entry;
      if (!entry.ok) {
        storageState.errors.push(entry);
        if (storageState.errors.length > 20) storageState.errors.shift();
      }
      return entry;
    }

    function fetchRemoteMasks() {
      let result = { ok: false, masks: [] };
      const info = { op: 'read', ok: false, reason: 'request', status: null, code: null };
      const started = performance.now();
      $.ajax({
        async: false,
        url: HVSS_URLS.api,
        data: { method: 'storage.get', key: 'maskListUser' },
        success: function (res, textStatus, xhr) {
          info.status = xhr.status;
          if (!res) {
            info.reason = 'empty-response';
            return;
          }
          if (res.error) {
            info.code = res.error.code != null ? String(res.error.code) : null;
            // 404 = ключа ещё нет, масок просто нет
            if (info.code === '404') {
              result = { ok: true, masks: [] };
              info.ok = true;
              info.reason = '';
              info.rawLength = 0;
              info.dropped = 0;
            } else {
              info.reason = 'api-error';
            }
            return;
          }
          const data = res.response && res.response.storage && res.response.storage.data;
          if (!data) {
            info.reason = 'no-data';
            return;
          }
          const raw = data.maskListUser;
          const masks = parseMaskStorage(raw);
          result = { ok: true, masks };
          info.ok = true;
          info.reason = '';
          info.rawLength = typeof raw === 'string' ? raw.length : 0;
          info.dropped = splitMaskStorage(raw).length - masks.length;
        },
        error: function (xhr, textStatus) {
          info.status = xhr.status;
          info.reason = textStatus === 'timeout' ? 'timeout' : 'request';
        }
      });
      info.ms = Math.round(performance.now() - started);
      recordStorageOp('lastRead', info);
      return result;
    }

    function splitMaskStorage(raw) {
      if (typeof raw !== 'string' || !raw) return [];
      let data;
      try {
        data = decodeURI(raw).split(MASK_SPLIT_KEY);
      } catch (e) {
        data = raw.split(MASK_SPLIT_KEY);
      }
      return data.filter(Boolean);
    }

    function parseMaskStorage(raw) {
      return clearResponse(splitMaskStorage(raw));
    }

    function writeRemoteMasks(masks) {
      const value = encodeMaskStorage(masks);
      const info = { op: 'write', ok: false, reason: 'request', status: null, code: null, count: masks.length, bytes: value.length };
      if (value.length >= STORAGE_LIMIT) {
        info.reason = 'overflow';
        recordStorageOp('lastWrite', info);
        return { ok: false, reason: 'overflow' };
      }

      const started = performance.now();
      let ok = false;
      $.ajax({
        async: false,
        type: 'POST',
        url: HVSS_URLS.api,
        data: {
          method: 'storage.set',
          token: window.ForumAPITicket,
          key: 'maskListUser',
          value,
        },
        success: function (res, textStatus, xhr) {
          info.status = xhr.status;
          if (res && res.error) {
            info.code = res.error.code != null ? String(res.error.code) : null;
            info.reason = 'api-error';
            return;
          }
          ok = !!res && String(res.response) === '1';
          info.reason = ok ? '' : 'bad-response';
        },
        error: function (xhr, textStatus) {
          info.status = xhr.status;
          info.reason = textStatus === 'timeout' ? 'timeout' : 'request';
        }
      });
      info.ok = ok;
      info.ms = Math.round(performance.now() - started);
      recordStorageOp('lastWrite', info);
      return { ok, reason: info.reason };
    }

    function persistMaskToUserStorage(mask, options = {}) {
      const maskToSave = cloneMask(mask || {});
      if (!Object.keys(maskToSave).length) {
        return false;
      }

      const maskString = JSON.stringify(maskToSave);
      if (maskString.includes(MASK_SPLIT_KEY)) {
        recordStorageOp(null, { op: 'save', ok: false, reason: 'splitKey' });
        notifyMaskError('В маске есть служебная последовательность ' + MASK_SPLIT_KEY + ', её нельзя сохранить в список.', options);
        return false;
      }

      const remote = fetchRemoteMasks();
      if (!remote.ok) {
        notifyMaskError('Не удалось загрузить список масок, маска не сохранена. Попробуй ещё раз.', options);
        return false;
      }

      const nextMasks = remote.masks.slice();
      if (options.replace && Object.keys(options.replace).length) {
        const replaceIndex = hasMaskInStorage(nextMasks, options.replace);
        if (replaceIndex !== -1) {
          nextMasks.splice(replaceIndex, 1);
        }
      }
      const existingIndex = hasMaskInStorage(nextMasks, maskToSave);
      if (existingIndex !== -1) {
        nextMasks.splice(existingIndex, 1);
      } else {
        while (nextMasks.length >= maskLimit) {
          nextMasks.shift();
        }
      }
      nextMasks.push(maskString);

      const result = writeRemoteMasks(nextMasks);
      if (!result.ok) {
        notifyMaskError(result.reason === 'overflow'
          ? 'Хранилище масок переполнено, не могу сохранить ещё маску 😔'
          : 'Ошибка сохранения, попробуй ещё раз.', options);
        return false;
      }

      prevMasks = nextMasks;
      if (options.updateUi) {
        refreshUi();
      }
      return true;
    }

    function hasMaskInStorage(storage, item) {
      const itemKeys = Object.keys(item);
      return storage.findIndex(str => {
        const obj = JSON.parse(str);
        const keys = Object.keys(obj);
        return keys.length === itemKeys.length
          && keys.every(key => JSON.stringify(obj[key]) === JSON.stringify(item[key]));
      });
    }

    // ---- hvScriptSet.data: отладка из консоли ----
    function safeCall(fn) {
      try {
        return fn();
      } catch (e) {
        return 'error: ' + e.message;
      }
    }

    function getStorageStats() {
      const encodedLength = encodeMaskStorage(prevMasks).length;
      return {
        count: prevMasks.length,
        limit: maskLimit,
        encodedLength,
        byteLimit: STORAGE_LIMIT,
        free: STORAGE_LIMIT - 1 - encodedLength,
        lastRead: storageState.lastRead,
        lastWrite: storageState.lastWrite,
        errors: storageState.errors.slice(),
      };
    }

    // Проверка целостности.
    function checkMaskIntegrity(options = {}) {
      const issues = [];
      const add = (level, code, message, extra) => issues.push(Object.assign({ level, code, message }, extra));
      const valid = [];

      prevMasks.forEach((str, index) => {
        let obj;
        try {
          obj = JSON.parse(str);
        } catch (e) {
          add('error', 'invalid-json', 'Маска не разбирается как JSON', { index });
          return;
        }
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
          add('error', 'bad-shape', 'Маска должна быть объектом', { index });
          return;
        }
        valid.push({ index, obj });

        if (str.includes(MASK_SPLIT_KEY)) {
          add('error', 'split-key', 'В маске есть разделитель списка ' + MASK_SPLIT_KEY, { index });
        }
        const keys = Object.keys(obj);
        if (!keys.length) {
          add('warn', 'empty-mask', 'Пустая маска', { index });
        }
        keys.forEach(key => {
          const field = obj[key];
          const type = field && typeof field === 'object' ? typeof field.value : null;
          if (type !== 'string' && type !== 'number') {
            add('error', 'bad-field', 'У поля нет корректного value', { index, key });
            return;
          }
          if (!changeList[key]) {
            add('warn', 'unknown-field', 'Поля нет в настройках скрипта', { index, key });
          }
          if (typeof field.value === 'string' && findHtmlViolation(parseInert(field.value))) {
            add('warn', 'unsafe-html', 'Значение содержит запрещённый html', { index, key });
          }
        });
      });

      valid.forEach(({ index, obj }, i) => {
        const dupIndex = hasMaskInStorage(valid.slice(0, i).map(m => JSON.stringify(m.obj)), obj);
        if (dupIndex !== -1) {
          add('warn', 'duplicate', 'Дубль маски', { index, duplicateOf: valid[dupIndex].index });
        }
      });

      if (prevMasks.length > maskLimit) {
        add('warn', 'over-limit', 'Масок больше лимита: ' + prevMasks.length + '/' + maskLimit);
      }
      const encodedLength = encodeMaskStorage(prevMasks).length;
      if (encodedLength >= STORAGE_LIMIT) {
        add('error', 'size-overflow', 'Размер списка превышает лимит хранилища');
      } else if (encodedLength >= STORAGE_LIMIT * 0.9) {
        add('warn', 'size-near-limit', 'Хранилище заполнено более чем на 90%');
      }

      if (options.remote) {
        const remote = fetchRemoteMasks();
        if (!remote.ok) {
          add('error', 'remote-unavailable', 'Не удалось прочитать список с сервера', {
            reason: storageState.lastRead && storageState.lastRead.reason,
          });
        } else {
          if (JSON.stringify(remote.masks) !== JSON.stringify(prevMasks)) {
            add('warn', 'out-of-sync', 'Список в странице не совпадает с сервером', {
              local: prevMasks.length,
              remote: remote.masks.length,
            });
          }
          if (storageState.lastRead && storageState.lastRead.dropped > 0) {
            add('warn', 'remote-invalid-entries', 'На сервере есть повреждённые записи, они пропадут при следующем сохранении', {
              count: storageState.lastRead.dropped,
            });
          }
        }
      }

      return { ok: !issues.some(item => item.level === 'error'), issues };
    }

    function buildMaskExport(list, source) {
      return JSON.stringify({
        format: 'hvss-masks',
        version: 1,
        exportedAt: new Date().toISOString(),
        userId: window.UserID || null,
        source,
        masks: list.map(str => JSON.parse(str)),
      });
    }

    function exportMasks() {
      const remote = fetchRemoteMasks();
      if (!remote.ok) {
        console.warn('hvScriptSet: сервер недоступен, выгружен список из страницы (может быть неактуален).');
      }
      const text = buildMaskExport(remote.ok ? remote.masks : prevMasks, remote.ok ? 'server' : 'cache');
      console.log(text);
      return text;
    }

    // options: { mode: 'merge' (по умолчанию) | 'replace', confirm: true (обязательно для replace), dryRun: true }
    function importMasks(input, options = {}) {
      const fail = (reason, message, extra) => {
        console.warn('hvScriptSet import: ' + message);
        return Object.assign({ ok: false, applied: false, reason, message }, extra);
      };
      const mode = options.mode === 'replace' ? 'replace' : 'merge';

      let payload = input;
      if (typeof input === 'string') {
        try {
          payload = JSON.parse(input);
        } catch (e) {
          return fail('invalid-json', 'Не удалось разобрать JSON.');
        }
      }
      const list = Array.isArray(payload) ? payload
        : (payload && payload.format === 'hvss-masks' && Array.isArray(payload.masks) ? payload.masks : null);
      if (!list) {
        return fail('bad-format', 'Ожидается результат export() или массив масок.');
      }
      if (payload.version > 1) {
        return fail('unsupported-version', 'Версия формата ' + payload.version + ' не поддерживается.');
      }

      const accepted = [];
      const rejected = [];
      const warnings = [];
      list.forEach((item, index) => {
        const reject = reason => rejected.push({ index, reason });
        if (!item || typeof item !== 'object' || Array.isArray(item)) return reject('bad-shape');
        const keys = Object.keys(item);
        if (!keys.length) return reject('empty-mask');
        for (const key of keys) {
          const field = item[key];
          const type = field && typeof field === 'object' ? typeof field.value : null;
          if (key === '__proto__' || (type !== 'string' && type !== 'number')) return reject('bad-field:' + key);
          if (typeof field.value === 'string' && findHtmlViolation(parseInert(field.value))) return reject('unsafe-html:' + key);
          if (!changeList[key]) warnings.push({ index, key, reason: 'unknown-field' });
        }
        const str = JSON.stringify(cloneMask(item));
        if (str.includes(MASK_SPLIT_KEY)) return reject('split-key');
        accepted.push(str);
      });

      if (!accepted.length) {
        return fail('nothing-to-import', 'Нет подходящих масок.', { rejected });
      }
      if (mode === 'replace' && options.confirm !== true && !options.dryRun) {
        return fail('confirm-required', 'Для режима replace нужно передать { confirm: true }.');
      }

      const remote = fetchRemoteMasks();
      if (!remote.ok) {
        return fail('remote-unavailable', 'Не удалось прочитать текущий список с сервера.');
      }

      const next = mode === 'replace' ? [] : remote.masks.slice();
      accepted.forEach(str => {
        const existing = hasMaskInStorage(next, JSON.parse(str));
        if (existing !== -1) next.splice(existing, 1);
        next.push(str);
      });
      const trimmed = Math.max(0, next.length - maskLimit);
      next.splice(0, trimmed);

      const summary = {
        mode,
        received: list.length,
        accepted: accepted.length,
        rejected,
        warnings,
        before: remote.masks.length,
        after: next.length,
        trimmedByLimit: trimmed,
        encodedLength: encodeMaskStorage(next).length,
      };

      if (options.dryRun) {
        console.log('hvScriptSet import (dryRun):', summary);
        return Object.assign({ ok: true, applied: false }, summary);
      }

      const backup = buildMaskExport(remote.masks, 'server');
      const result = writeRemoteMasks(next);
      if (!result.ok) {
        return fail(result.reason, 'Запись не удалась (' + result.reason + '), список на сервере не изменён.', summary);
      }

      prevMasks = next;
      refreshUi();
      console.log('hvScriptSet import:', summary);
      return Object.assign({ ok: true, applied: true, backup }, summary);
    }

    function setupDebugData() {
      const define = (name, getter) => Object.defineProperty(that.data, name, {
        enumerable: true,
        configurable: true,
        get: getter,
      });

      define('env', () => ({
        version: that.version,
        userId: window.UserID || null,
        hasApiTicket: !!window.ForumAPITicket,
        path: location.pathname + location.search,
        userAgent: navigator.userAgent,
      }));
      define('access', () => ({
        checkAccess: safeCall(checkAccess),
        checkAccessExtended: safeCall(checkAccessExtended),
        isAvatarOnlyMode: safeCall(isAvatarOnlyMode),
        forumAccessLevel: safeCall(getAccessByForumName),
        groupId: window.GroupID,
        groupTitle: window.GroupTitle,
        forumName: safeCall(() => window.FORUM && window.FORUM.topic
          ? getClearedForumName(window.FORUM.topic.forum_name) : null),
      }));
      define('storage', getStorageStats);

      // options: { remote: false } — без проверки сервера
      that.data.report = function (options = {}) {
        const integrity = checkMaskIntegrity({ remote: options.remote !== false });
        const report = {
          createdAt: new Date().toISOString(),
          env: that.data.env,
          access: that.data.access,
          storage: getStorageStats(),
          integrity,
        };
        console.log(JSON.stringify(report, null, 2));
        return report;
      };
      that.data.export = exportMasks;
      that.data.import = importMasks;
    }

    function convertTagsToFormMask(tags) {
      const formMask = {};
      for (let field in tags) {
        if (tags.hasOwnProperty(field)) {
          formMask[field] = {
            tag: tags[field].tag,
            value: tags[field].content
          };
        }
      }
      return formMask;
    }

    function extractMaskFromMessage(message) {
      const blockPattern = /\[block=hvmask\]([\s\S]*?)\[\/block\]/gmi;
      const blocks = message.match(blockPattern) || [];
      if (!blocks.length) {
        return {
          cleanMessage: message,
          mask: {}
        };
      }
      const tagsText = blocks
        .map(item => item.replace(/\[block=hvmask\]|\[\/block\]/gmi, ''))
        .join('');
      const cleanMessage = message.replace(blockPattern, '').trim();
      return {
        cleanMessage,
        mask: convertTagsToFormMask(getTags(tagsText))
      };
    }

    function cloneMask(mask) {
      return JSON.parse(JSON.stringify(mask || {}));
    }

    function isAvatarOnlyMode() {
      const forumAccess = getAccessByForumName();
      return !checkAccessExtended() && (checkAccess() || forumAccess === 'common');
    }

    function getAllowedDialogMaskFields() {
      return isAvatarOnlyMode() ? ['avatar'] : Object.keys(changeList);
    }

    function normalizeMaskByAccess(mask) {
      const srcMask = cloneMask(mask);
      if (!isAvatarOnlyMode()) {
        return srcMask;
      }
      if (srcMask.avatar && srcMask.avatar.value) {
        return {
          avatar: srcMask.avatar
        };
      }
      return {};
    }

    function getCurrentTopicId() {
      if (!/viewtopic\.php/i.test(window.location.pathname)) {
        return null;
      }
      const topicId = new URLSearchParams(window.location.search).get('id');
      if (!topicId || !/^\d+$/.test(topicId)) {
        return null;
      }
      return topicId;
    }

    function getTopicMaskStorage() {
      try {
        const data = JSON.parse(localStorage.getItem(topicMaskStorageKey) || '{}');
        return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
      } catch (e) {
        return {};
      }
    }

    function setTopicMaskStorage(data) {
      try {
        if (!Object.keys(data).length) {
          localStorage.removeItem(topicMaskStorageKey);
          return;
        }
        localStorage.setItem(topicMaskStorageKey, JSON.stringify(data));
      } catch (e) {
        console.error('hvScriptSet: Не удалось сохранить маску темы в localStorage.', e);
      }
    }

    function getTopicMaskState(topicId) {
      if (!topicId) return null;
      const storage = getTopicMaskStorage();
      return storage[topicId] || null;
    }

    function setTopicMaskState(topicId, state) {
      if (!topicId) return;
      const storage = getTopicMaskStorage();
      storage[topicId] = state;
      setTopicMaskStorage(storage);
    }

    function removeTopicMaskState(topicId) {
      if (!topicId) return;
      const storage = getTopicMaskStorage();
      if (!storage[topicId]) return;
      delete storage[topicId];
      setTopicMaskStorage(storage);
    }

    function isMaskCodeInMessage() {
      return Boolean(responseMessageField && /\[block=hvmask\]/i.test(responseMessageField.value));
    }

    function getEffectiveMask() {
      if (isMaskCodeInMessage()) {
        const extracted = extractMaskFromMessage(responseMessageField.value);
        if (Object.keys(extracted.mask).length) {
          return normalizeMaskByAccess(extracted.mask);
        }
      }
      return cloneMask(tmpMask);
    }

    function adoptMaskFromMessageIfPresent() {
      if (!isMaskCodeInMessage()) return false;
      const extracted = extractMaskFromMessage(responseMessageField.value);
      if (!Object.keys(extracted.mask).length) return false;
      fillForm(normalizeMaskByAccess(extracted.mask));
      return true;
    }

    function removeMaskCodeFromMessage(options = {}) {
      if (!responseMessageField) {
        refreshUi();
        return;
      }
      if (!options.skipAdopt) {
        adoptMaskFromMessageIfPresent();
      }
      responseMessageField.value = extractMaskFromMessage(responseMessageField.value).cleanMessage;
      refreshUi();
    }

    function insertMaskCodeToMessage() {
      if (!responseMessageField || !hasActiveMask()) return;
      const baseMessage = extractMaskFromMessage(responseMessageField.value).cleanMessage;
      responseMessageField.value = `${baseMessage}\n${getStrMask()}`.trim();
      refreshUi();
    }

    function toggleMaskCodeInMessage() {
      if (isMaskCodeInMessage()) {
        removeMaskCodeFromMessage();
        return;
      }
      insertMaskCodeToMessage();
    }

    function injectMaskToMessage() {
      if (!responseMessageField) return;
      if (isMaskCodeInMessage()) {
        adoptMaskFromMessageIfPresent();
        return;
      }
      const baseMessage = extractMaskFromMessage(responseMessageField.value).cleanMessage;
      const maskString = Object.keys(tmpMask).length ? getStrMask() : '';
      responseMessageField.value = maskString ? `${baseMessage}\n${maskString}`.trim() : baseMessage;
    }

    function hasActiveMask() {
      return Object.keys(tmpMask).length > 0;
    }

    function el(tag, attrs, children) {
      const node = document.createElement(tag);
      if (attrs) {
        Object.keys(attrs).forEach(key => {
          const value = attrs[key];
          if (value === undefined || value === null || value === false) return;
          if (key === 'className') node.className = value;
          else if (key === 'text') node.textContent = value;
          else if (key === 'html') node.innerHTML = value;
          else if (key === 'dataset') Object.assign(node.dataset, value);
          else if (key.indexOf('on') === 0 && typeof value === 'function') node.addEventListener(key.slice(2), value);
          else if (value === true) node.setAttribute(key, '');
          else node.setAttribute(key, value);
        });
      }
      (children || []).forEach(child => {
        if (child === null || child === undefined || child === false) return;
        node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
      });
      return node;
    }

    function byId(id) {
      return document.getElementById(id);
    }

    function forumButton(value, onClick, className) {
      return el('input', {
        type: 'button',
        className: 'button' + (className ? ' ' + className : ''),
        value,
        onclick: event => {
          event.preventDefault();
          onClick(event);
        }
      });
    }

    function buildPanel(children) {
      const panel = el('form', { className: 'hv-panel', novalidate: true }, children);
      panel.addEventListener('submit', event => event.preventDefault());
      return panel;
    }

    function forumActions(buttons, className) {
      return el('div', { className: 'formsubmit hv-actions' + (className ? ' ' + className : '') }, buttons);
    }

    function makeImg(src, className) {
      const image = el('img', { className, src, alt: '' });
      image.addEventListener('error', () => {
        if (image.dataset.hvFallback) return;
        image.dataset.hvFallback = '1';
        image.src = defaultAvatar;
      });
      return image;
    }

    function checkRow(title, hint, checked, onChange) {
      const input = el('input', { type: 'checkbox' });
      input.checked = Boolean(checked);
      input.addEventListener('change', () => onChange(input.checked));
      return el('label', { className: 'hv-check' }, [
        input,
        el('span', null, [title, hint ? el('small', { className: 'hv-muted', text: hint }) : null])
      ]);
    }

    function isTouchUi() {
      return Boolean(window.matchMedia && window.matchMedia('(hover: none)').matches);
    }

    function isSheetMode() {
      return Boolean(window.matchMedia && window.matchMedia(MOBILE_QUERY).matches);
    }

    function checkImage(src) {
      return /\.(jpe?g|png|gif|webp)/i.test(String(src || ''));
    }

    function safeImageSrc(src, fallback) {
      const value = typeof src === 'string' ? src.trim() : '';
      return /^https?:\/\//i.test(value) ? value : fallback;
    }

    function maskAvatar(mask) {
      return mask && mask.avatar && mask.avatar.value ? String(mask.avatar.value) : '';
    }

    function maskImage(mask) {
      return safeImageSrc(maskAvatar(mask), defaultAvatar);
    }

    function maskNick(mask) {
      return mask && mask.author && mask.author.value ? htmlToText(String(mask.author.value)) : '';
    }

    function maskStatus(mask) {
      return mask && mask.title && mask.title.value ? htmlToText(String(mask.title.value)) : '';
    }

    function isAvatarOnlyMask(mask) {
      const keys = Object.keys(mask || {});
      return keys.length === 1 && keys[0] === 'avatar';
    }

    function maskCaption(mask) {
      return maskNick(mask) || (isAvatarOnlyMask(mask) ? 'только аватар' : 'без ника');
    }

    function sameMask(a, b) {
      if (!a || !b || !Object.keys(a).length) return false;
      return hasMaskInStorage([JSON.stringify(a)], b) === 0;
    }

    function parseStoredMask(str) {
      try {
        const mask = JSON.parse(str);
        return mask && typeof mask === 'object' && !Array.isArray(mask) ? mask : null;
      } catch (e) {
        return null;
      }
    }

    function storedMasks() {
      const list = [];
      prevMasks.forEach((str, index) => {
        const mask = parseStoredMask(str);
        if (mask) list.push({ index, mask });
      });
      return list.reverse();
    }

    function currentAvatarSrc() {
      return tmpMask.avatar && checkImage(tmpMask.avatar.value)
        ? safeImageSrc(tmpMask.avatar.value, getAvatar())
        : getAvatar();
    }

    function currentNick() {
      return maskNick(tmpMask) || window.UserLogin;
    }

    function getStyle() {
      const href = opt.styleUrl || HVSS_URLS.style;
      const exists = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
        .some(link => link.href === href);
      if (exists) return;
      const style = document.createElement('link');
      style.rel = 'stylesheet';
      style.href = href;
      const docstyle = document.head.querySelector('link[href*="style"]');
      document.head.insertBefore(style, docstyle);
    }

    function parseRgb(color) {
      const match = String(color).match(/rgba?\(([^)]+)\)/);
      if (!match) return null;
      const parts = match[1].split(',').map(part => parseFloat(part));
      return parts.length >= 3 ? { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 } : null;
    }

    function luminance(rgb) {
      const channel = value => {
        const v = value / 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
    }

    function contrast(a, b) {
      const la = luminance(a);
      const lb = luminance(b);
      return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    }

    function getFormBackgroundColor() {
      let node = (responseMessageField && responseMessageField.parentElement)
        || document.querySelector('#pun-main') || document.body;
      while (node && node.nodeType === 1) {
        const rgb = parseRgb(getComputedStyle(node).backgroundColor);
        if (rgb && rgb.a > 0.5) return rgb;
        node = node.parentElement;
      }
      return { r: 255, g: 255, b: 255, a: 1 };
    }

    function getForumAccent() {
      const background = getFormBackgroundColor();
      const links = Array.from(document.querySelectorAll('.punbb .post-links a, .punbb .pl-quote a, .punbb .post-content a, .punbb .crumbs a, #pun-crumbs1 a, .punbb a[href]')).slice(0, 300);
      for (const link of links) {
        const rgb = parseRgb(getComputedStyle(link).color);
        if (rgb && rgb.a > 0.5 && contrast(rgb, background) >= 3) {
          return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
        }
      }
      return '';
    }

    function applyAccent(node) {
      const accent = getForumAccent();
      if (node && accent) {
        node.style.setProperty('--hv-accent', accent);
        const rgb = parseRgb(accent);
        node.style.setProperty('--hv-accent-contrast', rgb && luminance(rgb) > 0.4 ? '#000' : '#fff');
      }
    }

    function isTransparentBackground(style) {
      const color = style.backgroundColor;
      const noColor = !color || color === 'transparent' || /^rgba\((?:[^,]+,){3}\s*0\)$/.test(color);
      return noColor && (!style.backgroundImage || style.backgroundImage === 'none');
    }

    function ensurePanelBackground(panel) {
      if (!panel) return;
      panel.style.backgroundColor = '';
      if (!isTransparentBackground(getComputedStyle(panel))) return;
      const color = getFormBackgroundColor();
      panel.style.backgroundColor = `rgb(${color.r}, ${color.g}, ${color.b})`;
    }

    function addButton() {
      const form = document.getElementById('form-buttons');
      if (!form || !(checkAccess() || checkAccessExtended() || getAccessByForumName())) {
        return null;
      }
      const button = document.createElement('td');
      button.id = 'button-mask';
      button.title = 'Маска профиля';
      button.innerHTML = `<img src="${HVSS_URLS.blankImage}" alt="">`;
      const bgImage = opt.buttonImage || HVSS_URLS.buttonImage;
      button.style.backgroundImage = 'url("' + bgImage + '")';
      form.getElementsByTagName('tr')[0].appendChild(button);
      applyAccent(button);
      maskButton = button;
      return button;
    }

    function getDialog() {
      const button = addButton();
      if (button) {
        button.addEventListener('click', event => {
          event.preventDefault();
          const hasAnyAccess = checkAccess() || checkAccessExtended() || Boolean(getAccessByForumName());
          if (!hasAnyAccess) return;
          togglePopover(button);
        });
      }
      if (!byId('mask_dialog')) {
        const main = document.querySelector('#pun-main') || document.querySelector('div.punbb') || document.body;
        main.appendChild(buildMaskDialog());
      }
      ensureLayer();
    }

    function mountChip(form) {
      let wrap = form.querySelector('.hv-post-as');
      if (!wrap) {
        const chipId = 'hv-chip-' + Math.random().toString(36).slice(2, 8);
        const chip = el('button', {
          type: 'button',
          id: chipId,
          className: 'hv-chip',
          'aria-haspopup': 'dialog',
          'aria-expanded': 'false'
        }, [
          makeImg(getAvatar(), 'hv-chip-avatar'),
          el('b', { className: 'hv-chip-nick' }),
          el('i', { className: 'hv-chip-flag hv-chip-pin', title: 'Маска закреплена в этой теме', html: ICONS.pin }),
          el('i', { className: 'hv-chip-flag hv-chip-code', title: 'Код маски в тексте поста', html: ICONS.code }),
          el('i', { className: 'hv-chip-caret', html: ICONS.caretUp })
        ]);
        chip.addEventListener('click', event => {
          event.preventDefault();
          togglePopover(chip);
        });
        const caption = el('em', { className: 'hv-post-as-label', text: '', 'aria-hidden': 'true' });
        caption.addEventListener('click', () => togglePopover(chip));
        wrap = el('div', { className: 'hv-post-as hv-root' }, [
          el('div', { className: 'hv-post-as-inner' }, [caption, chip])
        ]);
        placeChip(form, wrap);
        applyAccent(wrap);
      }
      ui.chip = wrap.querySelector('.hv-chip');
    }

    function placeChip(form, wrap) {
      const submitRow = form.querySelector('.formsubmit');
      if (submitRow && submitRow.parentNode) {
        submitRow.parentNode.insertBefore(wrap, submitRow);
      } else {
        wrap.classList.add('is-static');
        responseMessageField.parentNode.insertBefore(wrap, responseMessageField.nextSibling);
      }
    }

    function refreshUi() {
      renderIndicator();
      if (ui.open) {
        renderPopover();
      }
    }

    function renderIndicator() {
      const hasMask = hasActiveMask();
      const pinned = hasMask && topicPinned;
      const code = hasMask && isMaskCodeInMessage();
      const nick = hasMask ? currentNick() : window.UserLogin;
      if (maskButton) {
        maskButton.classList.toggle('hv-has-mask', hasMask);
        maskButton.title = hasMask ? 'Маска профиля: ' + nick : 'Маска профиля';
      }
      document.querySelectorAll('.hv-chip').forEach(chip => {
        chip.classList.toggle('is-masked', hasMask);
        chip.classList.toggle('is-pinned', pinned);
        chip.classList.toggle('has-code', code);
        const image = chip.querySelector('.hv-chip-avatar');
        const src = currentAvatarSrc();
        if (image && image.getAttribute('src') !== src) {
          delete image.dataset.hvFallback;
          image.src = src;
        }
        chip.querySelector('.hv-chip-nick').textContent = nick;
        const expanded = ui.open && ui.anchor === chip;
        chip.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        chip.querySelector('.hv-chip-caret').innerHTML = expanded ? ICONS.caretDown : ICONS.caretUp;
        const parts = [hasMask ? `Пост от ${nick}, маска` : `Пост от ${nick}, без маски`];
        if (pinned) parts.push('закреплена в этой теме');
        if (code) parts.push('код маски в тексте поста');
        chip.title = parts.join(', ') + '. Открыть маски';
        chip.setAttribute('aria-label', chip.title);
      });
    }

    function ensureLayer() {
      if (ui.layer && document.body.contains(ui.layer)) return ui.layer;
      ui.layer = el('div', { id: 'hv-mask-layer', className: 'hv-layer hv-root' });
      ui.shade = el('div', { className: 'hv-shade', hidden: true, onclick: () => closePopover() });
      ui.popover = el('div', { className: 'hv-popover', role: 'dialog', 'aria-label': 'Маски', hidden: true });
      ui.layer.appendChild(ui.shade);
      ui.layer.appendChild(ui.popover);
      (document.querySelector('div.punbb') || document.body).appendChild(ui.layer);
      applyAccent(ui.layer);
      if (!ui.globalBind) {
        ui.globalBind = true;
        document.addEventListener('mousedown', onDocumentPointer, true);
        document.addEventListener('touchstart', onDocumentPointer, { capture: true, passive: true });
        document.addEventListener('keydown', onDocumentKey);
        window.addEventListener('resize', () => positionPopover());
        window.addEventListener('scroll', () => positionPopover(), true);
      }
      return ui.layer;
    }

    function onDocumentPointer(event) {
      const target = event.target;
      if (!target || !target.closest) return;
      if (ui.menu && !ui.menu.contains(target)) {
        closeTileMenu();
      }
      if (!ui.open) return;
      if (ui.popover.contains(target) || (ui.menu && ui.menu.contains(target))) return;
      if (target.closest('.hv-chip') || target.closest('#button-mask') || target.closest('#mask_dialog')) return;
      closePopover();
    }

    function onDocumentKey(event) {
      if (event.key !== 'Escape') return;
      if (ui.menu) {
        closeTileMenu();
        return;
      }
      if (isEditorOpen()) {
        cancelMask();
        return;
      }
      if (ui.open) {
        const anchor = ui.anchor;
        closePopover();
        if (anchor && anchor.focus) anchor.focus();
      }
    }

    function togglePopover(anchor) {
      if (ui.open && ui.anchor === anchor) {
        closePopover();
        return;
      }
      openPopover(anchor);
    }

    function openPopover(anchor) {
      ensureLayer();
      if (isMaskCodeInMessage()) {
        adoptMaskFromMessageIfPresent();
      }
      ui.anchor = anchor || ui.chip || maskButton;
      ui.side = null;
      ui.open = true;
      ui.popover.hidden = false;
      renderPopover();
      renderIndicator();
    }

    function closePopover() {
      if (!ui.open) return;
      ui.open = false;
      closeTileMenu();
      ui.popover.hidden = true;
      ui.shade.hidden = true;
      renderIndicator();
    }

    function positionPopover() {
      if (!ui.open || !ui.popover) return;
      const sheet = isSheetMode();
      ui.layer.classList.toggle('is-sheet', sheet);
      ui.shade.hidden = !sheet;
      if (sheet) {
        ui.popover.style.left = '';
        ui.popover.style.top = '';
        return;
      }
      const anchor = ui.anchor && document.body.contains(ui.anchor) ? ui.anchor : (ui.chip || maskButton);
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const width = ui.popover.offsetWidth;
      const height = ui.popover.offsetHeight;
      const pad = 8;
      const gap = 6;
      if (!ui.side) {
        const fitsAbove = rect.top - height - gap >= pad;
        const fitsBelow = rect.bottom + gap + height <= window.innerHeight - pad;
        ui.side = fitsAbove || !fitsBelow && rect.top > window.innerHeight - rect.bottom ? 'above' : 'below';
      }
      let top = ui.side === 'above' ? rect.top - height - gap : rect.bottom + gap;
      top = Math.max(pad, Math.min(top, window.innerHeight - height - pad));
      const left = Math.min(Math.max(pad, rect.right - width), Math.max(pad, window.innerWidth - width - pad));
      ui.popover.style.left = Math.round(left) + 'px';
      ui.popover.style.top = Math.round(top) + 'px';
    }

    function renderPopover() {
      if (!ui.popover) return;
      const panel = buildPanel([
        el('div', { className: 'hv-pop-title', text: 'Маска профиля' })
      ]);
      if (isAvatarOnlyMode()) {
        buildAvatarOnlyContent(panel);
      } else {
        buildFullContent(panel);
      }
      const scrollTop = ui.popover.scrollTop;
      const oldTiles = ui.popover.querySelector('.hv-tiles');
      const tilesScroll = oldTiles ? [oldTiles.scrollLeft, oldTiles.scrollTop] : [0, 0];
      ui.popover.replaceChildren(panel);
      ensurePanelBackground(panel);
      ui.popover.scrollTop = scrollTop;
      const newTiles = ui.popover.querySelector('.hv-tiles');
      if (newTiles) {
        newTiles.scrollLeft = tilesScroll[0];
        newTiles.scrollTop = tilesScroll[1];
      }
      positionPopover();
    }

    function reserveRow(node, visible) {
      if (!node) return null;
      if (!visible) {
        node.classList.add('hv-reserve');
        node.setAttribute('aria-hidden', 'true');
        node.querySelectorAll('input, button, a').forEach(control => {
          control.disabled = true;
          control.tabIndex = -1;
        });
      }
      return node;
    }

    function buildFullContent(panel) {
      const hasMask = hasActiveMask();
      const current = el('div', { className: 'hv-pop-section' }, [
        el('div', { className: 'hv-pop-head' }, [el('b', { text: 'Текущая' })]),
        el('div', { className: 'hv-current' }, [
          hasMask ? makeImg(currentAvatarSrc(), 'hv-current-avatar') : el('i', { className: 'hv-current-placeholder' }),
          el('div', { className: 'hv-current-text' }, [
            el('div', { className: 'hv-current-name', text: hasMask ? currentNick() : 'Без маски' }),
            el('div', {
              className: 'hv-muted hv-current-status',
              text: hasMask
                ? maskStatus(tmpMask) || (isAvatarOnlyMask(tmpMask) ? 'меняется только аватар' : '\u00a0')
                : ''
            })
          ])
        ])
      ]);
      current.appendChild(reserveRow(forumActions([
        forumButton('Редактировать', () => editCurrentMask()),
        forumButton('Снять', () => takeOffMask())
      ], 'hv-actions-fill'), hasMask));
      if (getCurrentTopicId()) {
        current.appendChild(reserveRow(checkRow('Закрепить в этой теме', 'надевается сама в каждом новом ответе',
          topicPinned, on => togglePin(on)), hasMask));
      }
      if (responseMessageField) {
        current.appendChild(reserveRow(checkRow('Показать код в поле ответа', 'отредактированный код маски сохранится',
          isMaskCodeInMessage(), on => toggleCode(on)), hasMask));
      }
      panel.appendChild(current);
      panel.appendChild(buildMaskList(false));
    }

    function buildAvatarOnlyContent(panel) {
      panel.appendChild(el('div', {
        className: 'hv-notice hv-muted',
        text: 'В этом разделе маска меняет только аватар. Ник, статус и остальное — из профиля.'
      }));
      const hasMask = hasActiveMask();
      const source = hasMask ? storedMasks().find(item => maskAvatar(item.mask) === maskAvatar(tmpMask)) : null;
      const current = el('div', { className: 'hv-pop-section' }, [
        el('div', { className: 'hv-pop-head' }, [el('b', { text: 'В этом посте' })]),
        el('div', { className: 'hv-current' }, [
          makeImg(currentAvatarSrc(), 'hv-current-avatar'),
          el('div', { className: 'hv-current-text' }, [
            el('div', { className: 'hv-current-name', text: window.UserLogin }),
            el('div', {
              className: 'hv-muted',
              text: !hasMask ? 'без маски' : 'под маской'
            })
          ]),
          reserveRow(forumActions([forumButton('Снять', () => takeOffMask())], 'hv-actions-inline'), hasMask)
        ])
      ]);
      if (getCurrentTopicId()) {
        current.appendChild(reserveRow(checkRow('Закрепить в этой теме', '', topicPinned, on => togglePin(on)), hasMask));
      }
      panel.appendChild(current);

      const list = buildMaskList(true);
      const tag = changeList.avatar.tag.split(',')[0];
      const controls = buildAvatarControls({
        placeholder: 'Ссылка на картинку',
        onUrl: url => pickMask({ avatar: { tag, value: url } }),
        nameHint: () => ''
      });
      controls.input.addEventListener('change', () => {
        const value = controls.input.value.trim();
        if (!value) return;
        if (!checkImage(value) || !/^https?:\/\//i.test(value)) {
          controls.setStatus('Нужна прямая ссылка на картинку jpg, gif, png или webp', true);
          return;
        }
        pickMask({ avatar: { tag, value } });
      });
      list.appendChild(controls.row);
      list.appendChild(el('div', {
        className: 'hv-muted hv-small',
        text: canUpload() ? 'После загрузки ссылка подставится сама.' : ''
      }));
      list.appendChild(controls.status);
      panel.appendChild(list);
    }

    function buildMaskList(avatarOnly) {
      const all = storedMasks();
      const list = avatarOnly ? all.filter(item => checkImage(maskAvatar(item.mask))) : all;
      const section = el('div', { className: 'hv-pop-section' });
      const head = el('div', { className: 'hv-pop-head' }, [
        el('b', { text: avatarOnly ? 'Мои аватары' : 'Мои маски' }),
        el('span', {
          className: 'hv-muted',
          text: avatarOnly ? String(list.length) : `масок: ${prevMasks.length}/${maskLimit}`
        })
      ]);
      const grid = el('div', { className: 'hv-tiles' + (avatarOnly ? ' hv-tiles-avatars' : '') });
      list.forEach(item => grid.appendChild(buildTile(item.mask, item.index, avatarOnly)));
      if (!avatarOnly) {
        grid.appendChild(el('button', {
          type: 'button',
          className: 'hv-tile hv-tile-new',
          title: 'Новая маска',
          onclick: event => {
            event.preventDefault();
            openEditor({}, { title: 'Новая маска' });
          }
        }, [el('i', { className: 'hv-tile-plus', text: '+' }), el('b', { className: 'hv-tile-name', text: 'Новая' })]));
      }
      section.appendChild(head);
      section.appendChild(grid);
      let hint = '';
      if (avatarOnly) {
        hint = list.length ? 'Маски без аватара здесь не показаны.' : 'Нет сохраненных аватаров.';
      } else if (list.length) {
        hint = isTouchUi()
          ? 'Нажмите — надеть. Удерживайте — изменить или удалить.'
          : 'Лкм — надеть, пкм — изменить или удалить.';
      }
      if (hint) {
        section.appendChild(el('div', { className: 'hv-muted hv-small hv-hint', text: hint }));
      }
      return section;
    }

    function buildTile(mask, index, avatarOnly) {
      const active = avatarOnly
        ? hasActiveMask() && maskAvatar(tmpMask) === maskAvatar(mask)
        : sameMask(tmpMask, normalizeMaskByAccess(mask));
      const caption = maskCaption(mask);
      const status = maskStatus(mask);
      const tile = el('button', {
        type: 'button',
        className: 'hv-tile' + (active ? ' is-active' : ''),
        title: status ? `${caption} — ${status}` : caption,
        'aria-pressed': active ? 'true' : 'false',
        'aria-label': avatarOnly ? 'Аватар маски ' + caption : null,
        dataset: { search: (caption + ' ' + status).toLowerCase() }
      }, [
        makeImg(maskImage(mask), 'hv-tile-avatar'),
        avatarOnly ? null : el('b', { className: 'hv-tile-name', text: caption })
      ]);
      tile.addEventListener('click', event => {
        event.preventDefault();
        if (tile.dataset.longPress) {
          delete tile.dataset.longPress;
          return;
        }
        pickMask(avatarOnly ? { avatar: mask.avatar } : mask);
      });
      if (!avatarOnly) {
        tile.addEventListener('contextmenu', event => {
          event.preventDefault();
          openTileMenu(event.clientX, event.clientY, index);
        });
        let timer = null;
        tile.addEventListener('touchstart', event => {
          const touch = event.touches[0];
          timer = setTimeout(() => {
            tile.dataset.longPress = '1';
            openTileMenu(touch.clientX, touch.clientY, index);
          }, 550);
        }, { passive: true });
        ['touchend', 'touchmove', 'touchcancel'].forEach(name => {
          tile.addEventListener(name, () => clearTimeout(timer), { passive: true });
        });
      }
      return tile;
    }

    function openTileMenu(x, y, index) {
      closeTileMenu();
      const panel = buildPanel([
        forumActions([
          forumButton('Редактировать', () => {
            closeTileMenu();
            editStoredMask(index);
          }),
          forumButton('Удалить', () => {
            closeTileMenu();
            deleteMaskFromStorage(index);
          })
        ], 'hv-actions-column')
      ]);
      ui.menu = el('div', { className: 'hv-menu', role: 'menu' }, [panel]);
      ui.layer.appendChild(ui.menu);
      ensurePanelBackground(panel);
      const width = ui.menu.offsetWidth;
      const height = ui.menu.offsetHeight;
      ui.menu.style.left = Math.max(8, Math.min(x, window.innerWidth - width - 8)) + 'px';
      ui.menu.style.top = Math.max(8, Math.min(y, window.innerHeight - height - 8)) + 'px';
    }

    function closeTileMenu() {
      if (ui.menu) {
        ui.menu.remove();
        ui.menu = null;
      }
    }

    function pickMask(mask) {
      const wasPinned = topicPinned;
      fillForm(mask);
      persistOnSubmit = true;
      if (wasPinned) {
        const state = getTopicMaskState(getCurrentTopicId());
        if (!state || !sameMask(state.mask, tmpMask)) {
          togglePin(false);
        }
      }
      syncCodeInMessage();
      refreshUi();
    }

    function takeOffMask() {
      if (topicPinned) {
        togglePin(false);
      }
      clearMask();
    }

    function togglePin(on) {
      const topicId = getCurrentTopicId();
      if (!topicId) return;
      if (!on) {
        topicPinned = false;
        removeTopicMaskState(topicId);
        refreshUi();
        return;
      }
      adoptMaskFromMessageIfPresent();
      const maskToSave = getEffectiveMask();
      if (Object.keys(maskToSave).length) {
        topicPinned = true;
        setTopicMaskState(topicId, { remember: true, mask: cloneMask(maskToSave) });
      }
      refreshUi();
    }

    function toggleCode(on) {
      if (on) {
        insertMaskCodeToMessage();
      } else {
        removeMaskCodeFromMessage();
      }
      refreshUi();
    }

    function syncCodeInMessage() {
      if (!isMaskCodeInMessage()) return;
      if (hasActiveMask()) {
        insertMaskCodeToMessage();
      } else {
        removeMaskCodeFromMessage({ skipAdopt: true });
      }
    }

    function editCurrentMask() {
      const storedIndex = hasMaskInStorage(prevMasks, tmpMask);
      openEditor(cloneMask(tmpMask), { title: 'Маска', original: storedIndex !== -1 ? cloneMask(tmpMask) : null });
    }

    function editStoredMask(index) {
      const mask = parseStoredMask(prevMasks[index]);
      if (mask) {
        openEditor(mask, { title: 'Маска', original: mask });
      }
    }

    function deleteMaskFromStorage(index) {
      const target = prevMasks[index];
      if (target === undefined) return;
      if (!confirm('Точно удалить маску?')) return;

      const remote = fetchRemoteMasks();
      if (!remote.ok) {
        $.jGrowl('Не удалось загрузить список масок, маска не удалена. Попробуйте ещё раз.');
        return;
      }
      const nextMasks = remote.masks.slice();
      const position = nextMasks.indexOf(target);
      if (position !== -1) {
        nextMasks.splice(position, 1);
        if (!writeRemoteMasks(nextMasks).ok) {
          $.jGrowl('Ошибка удаления, попробуй ещё раз.');
          return;
        }
      }
      prevMasks = nextMasks;
      refreshUi();
    }

    function canUpload() {
      return Boolean(window.UploadsURL && window.UserUploadsDir && window.ForumAPITicket && window.UserID
        && window.FormData && window.fetch);
    }

    async function uploadAvatar(file, nameHint) {
      if (!/^image\/(gif|jpe?g|png|webp)$/i.test(file.type)) {
        throw new Error('Можно загрузить только gif, jpg, png или webp');
      }
      if (file.size > 10 * 1024 * 1024) {
        throw new Error('Файл больше 10 МБ');
      }
      const extMatch = file.name.match(/\.[a-z0-9]+$/i);
      const ext = extMatch ? extMatch[0] : '.' + file.type.split('/')[1];
      const base = (nameHint ? 'Маска — ' + nameHint : file.name.replace(/\.[^.]+$/, ''))
        .replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'avatar';
      const data = new FormData();
      data.append('method', 'upload.userfile');
      data.append('user_id', window.UserID);
      data.append('token', window.ForumAPITicket);
      data.append('thumb_width', '120');
      data.append('files[]', file, base + ext);
      let json = null;
      let response = null;
      try {
        response = await fetch(HVSS_URLS.upload, { method: 'POST', body: data, credentials: 'same-origin' });
        json = await response.json();
      } catch (e) {
        throw new Error('Не удалось загрузить файл, попробуй ещё раз');
      }
      const filename = json && json.response && json.response.filename;
      if (!response.ok || !filename) {
        const message = json && json.error && (json.error.message || json.error.text);
        throw new Error(message || 'Форум не принял файл');
      }
      return window.UploadsURL + window.UserUploadsDir + '/' + filename;
    }

    // options: { input?, placeholder?, onUrl(url), nameHint() }
    function buildAvatarControls(options) {
      const input = options.input || el('input', {
        type: 'text',
        inputmode: 'url',
        placeholder: options.placeholder || 'Ссылка на картинку',
        'aria-label': 'Ссылка на аватар'
      });
      const status = el('span', { className: 'hv-status hv-muted hv-small', 'aria-live': 'polite' });
      const setStatus = (text, isError) => {
        status.textContent = text || '';
        status.classList.toggle('is-error', Boolean(isError));
      };
      const parts = [input];
      let uploadButton = null;
      const file = el('input', { type: 'file', accept: 'image/gif,image/jpeg,image/png,image/webp', hidden: true });
      if (canUpload()) {
        uploadButton = forumButton('Загрузить', () => file.click());
        parts.push(forumActions([uploadButton], 'hv-actions-inline'), file);
      }
      const row = el('div', { className: 'hv-inline-row hv-drop-target' }, parts);

      async function handleFile(selected) {
        if (!selected) return;
        if (uploadButton) uploadButton.disabled = true;
        setStatus(`Загружаю ${selected.name}…`);
        try {
          const url = await uploadAvatar(selected, options.nameHint ? options.nameHint() : '');
          input.value = url;
          setStatus(`✓ ${selected.name} загружен на форум, ссылка подставлена`);
          options.onUrl(url);
        } catch (e) {
          setStatus(e.message || 'Не удалось загрузить файл', true);
        } finally {
          if (uploadButton) uploadButton.disabled = false;
          file.value = '';
        }
      }

      if (canUpload()) {
        file.addEventListener('change', () => handleFile(file.files[0]));
        row.addEventListener('dragover', event => {
          event.preventDefault();
          row.classList.add('is-dragover');
        });
        row.addEventListener('dragleave', () => row.classList.remove('is-dragover'));
        row.addEventListener('drop', event => {
          event.preventDefault();
          row.classList.remove('is-dragover');
          handleFile(event.dataTransfer && event.dataTransfer.files[0]);
        });
      }
      return { row, input, status, setStatus };
    }

    // ---- редактор ----
    function buildMaskDialog() {
      const dialog = el('div', { id: 'mask_dialog', className: 'hv-root', style: 'display: none' });
      const bg = el('div', { className: 'hv-bg' });
      bg.addEventListener('mousedown', event => {
        if (event.target === bg) cancelMask();
      });
      const inner = el('div', {
        className: 'inner hv-dialog',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'hv-dialog-title'
      });
      const back = el('a', {
        href: '#',
        className: 'hv-back',
        text: '‹ к маскам',
        onclick: event => {
          event.preventDefault();
          cancelMask();
          openPopover(ui.chip || maskButton);
        }
      });
      ui.dialogTitle = el('span', { id: 'hv-dialog-title', text: 'Маска профиля' });
      const title = el('div', { className: 'hv-mask-dialog-title' }, [back, ui.dialogTitle]);
      const errorListBlock = el('ul', { className: 'hv-error-list', style: 'display: none' });

      previewForm = el('div', { className: 'hv-preview' });
      const form = el('form', { id: 'mask_form', className: 'hv-editor-form', novalidate: true });
      form.addEventListener('submit', event => event.preventDefault());
      const fields = el('div', { className: 'hv-editor-fields' });
      buildEditorFields(fields);

      const body = el('div', { className: 'hv-editor-body' }, [opt.showPreview === false ? null : previewForm, fields]);
      ui.saveCheckbox = el('input', { type: 'checkbox' });
      ui.saveCheckbox.defaultChecked = true;
      ui.saveCheckbox.checked = true;
      const footer = el('div', { className: 'hv-editor-footer' }, [
        el('label', { className: 'hv-check' }, [ui.saveCheckbox, el('span', { text: 'Сохранить в «Мои маски»' })]),
        forumActions([
          forumButton('Надеть маску', () => applyEditor()),
          forumButton('Отмена', () => cancelMask())
        ])
      ]);

      form.appendChild(body);
      form.appendChild(footer);
      inner.appendChild(title);
      inner.appendChild(errorListBlock);
      inner.appendChild(form);
      bg.appendChild(inner);
      dialog.appendChild(bg);
      ui.dialogInner = inner;
      applyAccent(dialog);
      resetPreview();
      syncFormExtras(form);
      return dialog;
    }

    function buildEditorFields(form) {
      const allowed = getAllowedDialogMaskFields();
      const keys = Object.keys(changeList).filter(key => allowed.includes(key));
      const pair = ['author', 'title'].filter(key => keys.includes(key));
      const base = ['author', 'title', 'avatar', 'signature'];
      const ordered = []
        .concat(keys.filter(key => key === 'avatar'))
        .concat(keys.filter(key => !base.includes(key)))
        .concat(keys.filter(key => key === 'signature'));
      if (pair.length === 2) {
        form.appendChild(el('div', { className: 'hv-field-row' }, pair.map(buildField)));
      } else {
        pair.forEach(key => form.appendChild(buildField(key)));
      }
      ordered.forEach(key => form.appendChild(buildField(key)));
      form.appendChild(el('div', { className: 'hv-muted hv-small', text: 'Пустые поля остаются как в профиле.' }));
    }

    function buildField(key) {
      const conf = changeList[key];
      const id = 'mask_' + key;
      const isArea = ['html', 'signature', 'bbcode'].includes(conf.type);
      const input = isArea
        ? el('textarea', { id, rows: '2', placeholder: '' })
        : el('input', { type: 'text', id, autocomplete: 'off' });
      if (key === 'avatar') {
        input.setAttribute('inputmode', 'url');
        input.placeholder = 'https://…';
      }
      const head = el('div', { className: 'hv-field-head' }, [el('label', { for: id }, [el('b', { text: conf.title })])]);
      if (conf.description) {
        head.appendChild(el('span', { className: 'hv-muted hv-small', text: conf.description }));
      }
      head.appendChild(el('i', { className: 'hv-spacer' }));
      const limit = key === 'author' ? 25 : key === 'title' ? 50 : 0;
      if (limit) {
        head.appendChild(el('span', { className: 'hv-muted hv-small hv-count', dataset: { field: key, limit: String(limit) } }));
      }

      const apply = () => applyFieldValue(key);
      input.addEventListener('blur', apply);
      input.addEventListener('change', apply);
      input.addEventListener('input', () => {
        syncFormExtras();
        if (key === 'author' || key === 'title') {
          changeMaskForm(key, input.value);
        }
      });

      if (conf.defaultCode) {
        const code = conf.defaultCode;
        if (typeof code === 'string') {
          head.appendChild(forumActions([forumButton('« вставить шаблон', () => {
            input.value = code;
            apply();
          }, 'hv-add-template')], 'hv-actions-inline'));
        }
        if (Array.isArray(code)) {
          const select = el('select', { className: 'hv-add-template', 'aria-label': 'Вставить шаблон' },
            [el('option', { value: '', text: 'Вставить шаблон' })]
              .concat(code.map(item => el('option', { value: item.template, text: item.name }))));
          select.addEventListener('change', () => {
            if (!select.value) return;
            input.value = select.value;
            select.value = '';
            apply();
          });
          head.appendChild(select);
        }
      }

      const wrapper = el('div', { className: `hv-field hv-field-${key}` }, [head]);
      if (key === 'avatar') {
        const controls = buildAvatarControls({
          input,
          onUrl: () => applyFieldValue('avatar'),
          nameHint: () => {
            const author = byId('mask_author');
            return author ? author.value.trim() : '';
          }
        });
        ui.avatarStatus = controls.setStatus;
        wrapper.appendChild(controls.row);
        wrapper.appendChild(controls.status);
      } else {
        wrapper.appendChild(el('span', { className: 'input' }, [input]));
      }
      if (key === 'signature') {
        const hide = el('input', { type: 'checkbox', id: 'mask_signature_hide' });
        hide.addEventListener('change', () => {
          if (hide.checked) input.value = '';
          syncFormExtras();
          applyFieldValue('signature');
        });
        head.appendChild(el('label', { className: 'hv-check hv-check-inline' }, [hide, el('span', { text: 'Скрыть подпись' })]));
        wrapper.appendChild(el('div', { className: 'hv-muted hv-small hv-sig-caption' }));
      }
      return wrapper;
    }

    function syncFormExtras(formArg) {
      const form = formArg || byId('mask_form');
      if (!form) return;
      form.querySelectorAll('.hv-count').forEach(counter => {
        const input = form.querySelector('#mask_' + counter.dataset.field);
        const limit = Number(counter.dataset.limit);
        const length = input ? textLength(input.value) : 0;
        counter.textContent = `${length}/${limit}`;
        counter.classList.toggle('is-error', length > limit);
      });
      const hide = form.querySelector('#mask_signature_hide');
      const signature = form.querySelector('#mask_signature');
      if (hide && signature) {
        signature.disabled = hide.checked;
        signature.placeholder = hide.checked ? 'Подпись скрыта' : 'Подпись';
      }
    }

    function readFieldValue(key) {
      const input = byId('mask_' + key);
      if (!input) return '';
      if (key === 'signature') {
        const hide = byId('mask_signature_hide');
        if (hide && hide.checked) return NO_SIGNATURE;
      }
      return input.value;
    }

    function setFieldValue(key, value) {
      const input = byId('mask_' + key);
      if (!input) return;
      if (key === 'signature') {
        const hide = byId('mask_signature_hide');
        const hidden = value === NO_SIGNATURE;
        if (hide) hide.checked = hidden;
        input.value = hidden ? '' : value;
        return;
      }
      input.value = value;
    }

    function applyFieldValue(key) {
      if (!byId('mask_' + key)) return;
      const value = readFieldValue(key);
      if (value !== '' && !checkHtml(value)) {
        tmpMask[key] = {
          'tag': changeList[key].tag.split(',')[0],
          'value': value
        };
      } else {
        delete tmpMask[key];
      }
      changeMaskForm(key, value === NO_SIGNATURE ? '' : value);
      refreshUi();
    }

    function fillForm(obj) {
      const form = byId('mask_form');
      const normalizedMask = normalizeMaskByAccess(obj || {});
      for (let change in changeList) {
        if (!changeList.hasOwnProperty(change)) continue;
        const field = form ? form.querySelector('#mask_' + change) : null;
        if (!field) {
          delete tmpMask[change];
          changeMaskForm(change, '');
          continue;
        }
        if (normalizedMask[change]) {
          const value = String(normalizedMask[change].value);
          setFieldValue(change, value);
          tmpMask[change] = {
            'tag': normalizedMask[change].tag,
            'value': normalizedMask[change].value
          };
          changeMaskForm(change, value === NO_SIGNATURE ? '' : value);
        } else {
          setFieldValue(change, '');
          delete tmpMask[change];
          changeMaskForm(change, '');
        }
      }
      syncFormExtras();
      refreshUi();
    }

    function openEditor(mask, options = {}) {
      closePopover();
      const dialog = byId('mask_dialog');
      if (!dialog) return;
      dialogMaskSnapshot = cloneMask(tmpMask);
      editorOriginalMask = options.original ? cloneMask(options.original) : null;
      errorList = {};
      resetPreview();
      fillForm(mask || {});
      if (ui.dialogTitle) ui.dialogTitle.textContent = options.title || 'Маска профиля';
      if (ui.saveCheckbox) ui.saveCheckbox.checked = true;
      if (ui.avatarStatus) ui.avatarStatus('');
      showErrors();
      dialog.style.display = 'block';
      ensurePanelBackground(ui.dialogInner);
      const first = dialog.querySelector('#mask_form input[type="text"], #mask_form textarea');
      if (first) first.focus();
    }

    function hideMaskDialog() {
      const dialog = byId('mask_dialog');
      if (dialog) dialog.style.display = 'none';
    }

    function isEditorOpen() {
      const dialog = byId('mask_dialog');
      return Boolean(dialog && dialog.style.display !== 'none');
    }

    function applyEditor() {
      Object.keys(changeList).forEach(key => applyFieldValue(key));
      delete errorList.common;
      if (Object.keys(errorList).length) {
        showErrors();
        return;
      }
      const save = !ui.saveCheckbox || ui.saveCheckbox.checked;
      persistOnSubmit = save;
      if (save && hasActiveMask()) {
        if (!persistMaskToUserStorage(tmpMask, { updateUi: true, replace: editorOriginalMask })) {
          return;
        }
      }
      const topicId = getCurrentTopicId();
      if (topicPinned && topicId) {
        if (hasActiveMask()) {
          setTopicMaskState(topicId, { remember: true, mask: cloneMask(tmpMask) });
        } else {
          togglePin(false);
        }
      }
      syncCodeInMessage();
      editorOriginalMask = null;
      hideMaskDialog();
      refreshUi();
    }

    function cancelMask() {
      errorList = {};
      showErrors();
      fillForm(dialogMaskSnapshot || {});
      editorOriginalMask = null;
      hideMaskDialog();
    }

    function clearMask() {
      removeMaskCodeFromMessage({ skipAdopt: true });
      tmpMask = {};
      errorList = {};
      const form = byId('mask_form');
      if (form) form.reset();
      syncFormExtras();
      Object.keys(changeList).forEach(key => changeMaskForm(key, ''));
      showErrors();
      refreshUi();
    }

    function showErrors() {
      const block = document.querySelector('#mask_dialog .hv-error-list');
      if (!block) return;
      block.replaceChildren();
      Object.keys(errorList).forEach(key => block.appendChild(el('li', { text: errorList[key] })));
      block.style.display = Object.keys(errorList).length ? 'block' : 'none';
    }

    function buildPreviewPost() {
      let authorClass = 'post-author topic-starter online';
      let list = null;
      const own = Array.from(document.querySelectorAll('.post[data-user-id]')).find(post =>
        post.dataset.userId === String(window.UserID)
        && !post.closest('#mask_dialog')
        && post.querySelector('.post-author ul:not(.hv-mask)'));
      if (own) {
        const author = own.querySelector('.post-author');
        authorClass = author.className.replace(/\bhv-mask\b/g, '').trim();
        list = author.querySelector('ul').cloneNode(true);
      } else {
        list = el('ul');
      }
      const order = key => {
        const index = userFields.indexOf(changeList[key].class);
        return index === -1 ? 999 : index;
      };
      Object.keys(changeList)
        .filter(key => key !== 'signature')
        .sort((a, b) => order(a) - order(b))
        .forEach(key => {
          const cls = changeList[key].class;
          let item = list.querySelector('.' + cls);
          if (!item) {
            item = el('li', { className: cls });
            insertProfileField(list, cls, item);
            if (key === 'author') {
              item.innerHTML = '<span class="acchide">Автор:&nbsp;</span><a href="#" rel="nofollow"></a>';
              item.querySelector('a').textContent = window.UserLogin;
            } else if (key === 'title') {
              item.textContent = getUserTitle();
            }
          }
          if (key === 'avatar' && !item.querySelector('img')) {
            item.appendChild(el('img', { src: getAvatar(), alt: '' }));
          }
          item.classList.add('hv-preview-' + key);
          item.hvOriginal = item.innerHTML;
        });
      list.querySelectorAll('a').forEach(link => {
        link.setAttribute('href', '#');
        link.setAttribute('tabindex', '-1');
      });
      const author = el('div', { className: authorClass }, [list]);
      const post = el('div', { className: 'post topic-starter hv-preview-post' }, [el('div', { className: 'container' }, [author])]);
      let root = el('div', { className: 'topic hv-preview-topic' }, [post]);
      const topicScope = document.getElementById('pun-viewtopic');
      if (!topicScope || topicScope.closest('.hv-preview')) {
        root = el('div', { id: 'pun-viewtopic', className: 'hv-preview-scope' }, [root]);
      }
      return root;
    }

    function resetPreview() {
      if (!previewForm) return;
      previewForm.replaceChildren(
        el('div', { className: 'hv-muted hv-small hv-preview-caption', text: 'Предпросмотр' }),
        buildPreviewPost()
      );
    }

    function updatePreviewField(field, callback) {
      if (!previewForm || !previewForm.querySelector) return;
      const node = previewForm.querySelector(`.hv-preview-${field}`);
      if (node) callback(node);
    }

    function restorePreviewField(field) {
      updatePreviewField(field, node => {
        if (node.hvOriginal !== undefined) node.innerHTML = node.hvOriginal;
      });
    }

    function changeMaskForm(field, value) {
      switch (field) {
        case 'signature':
          break;
        case 'avatar':
          if (value !== '' && !checkImage(value)) {
            errorList[field] = 'В поле [Аватар] должна быть ссылка на картинку формата jpg, gif, png или webp';
          } else {
            delete errorList[field];
            updatePreviewField(field, node => {
              const image = node.querySelector('img');
              if (image) {
                image.src = safeImageSrc(value, getAvatar());
                image.removeAttribute('width');
                image.removeAttribute('height');
              }
            });
          }
          break;
        case 'author':
          if (textLength(value) > 25) {
            errorList[field] = 'Поле [Ник] не должно содержать больше 25 символов';
          } else {
            delete errorList[field];
            if (value === '') {
              restorePreviewField(field);
            } else {
              updatePreviewField(field, node => {
                const link = node.querySelector('a');
                (link || node).textContent = value;
              });
            }
          }
          break;
        case 'title':
          if (textLength(value) > 50) {
            errorList[field] = 'Поле [Статус] не должно содержать больше 50 символов';
          } else {
            delete errorList[field];
            if (value === '') {
              restorePreviewField(field);
            } else {
              updatePreviewField(field, node => {
                node.textContent = value;
              });
            }
          }
          break;
        default: {
          const str = value || '';
          if (textLength(str) > 999) {
            errorList[field] = `Поле [${changeList[field].title}] не должно содержать больше 999 символов`;
            break;
          }
          delete errorList[field];
          if (str === '') {
            restorePreviewField(field);
            break;
          }
          switch (changeList[field].type) {
            case 'text':
              updatePreviewField(field, node => {
                node.textContent = str;
              });
              break;
            case 'bbcode':
              updatePreviewField(field, node => {
                const violation = setSafeHtml(node, bbcodeToHtml(str));
                if (violation) {
                  errorList[field] = `В поле [${changeList[field].title}] ${violation}`;
                }
              });
              break;
            default: {
              const violation = checkHtml(str);
              if (violation) {
                errorList[field] = `В поле [${changeList[field].title}] ${violation}`;
              } else {
                updatePreviewField(field, node => {
                  setSafeHtml(node, str);
                });
              }
            }
          }
        }
      }
      showErrors();
    }

    function updateRememberTopicMaskState() {
      const topicId = getCurrentTopicId();
      topicPinned = false;
      if (!topicId) return;
      const state = getTopicMaskState(topicId);
      const hasSavedMask = Boolean(state && state.mask && Object.keys(state.mask).length);
      topicPinned = Boolean(state && state.remember === true && hasSavedMask);
      if (state && state.remember === true && !hasSavedMask) {
        removeTopicMaskState(topicId);
      }
    }

    function syncTopicMaskOnSubmit() {
      const topicId = getCurrentTopicId();
      adoptMaskFromMessageIfPresent();
      const maskToSave = getEffectiveMask();
      if (!topicId) return;
      if (!topicPinned || !Object.keys(maskToSave).length) {
        if (!Object.keys(maskToSave).length) topicPinned = false;
        removeTopicMaskState(topicId);
        return;
      }
      setTopicMaskState(topicId, {
        remember: true,
        mask: cloneMask(maskToSave)
      });
    }

    function restoreMaskAfterPost() {
      if (!responseMessageField) return;
      const topicMaskState = getTopicMaskState(getCurrentTopicId());
      if (topicMaskState && topicMaskState.remember && topicMaskState.mask
        && Object.keys(topicMaskState.mask).length) {
        fillForm(normalizeMaskByAccess(topicMaskState.mask));
      } else {
        clearMask();
      }
      updateRememberTopicMaskState();
      refreshUi();
    }

    function initResponsePreview(fromEdit = false) {
      responseMessageField = Array.from(document.querySelectorAll('textarea[name="req_message"]'))
        .find(field => !field.closest('#mask_dialog')) || null;
      if (!responseMessageField) return;

      const form = responseMessageField.form;
      if (!form) return;
      const topicId = getCurrentTopicId();
      const topicMaskState = getTopicMaskState(topicId);

      if (!fromEdit) {
        updateRememberTopicMaskState();
      }

      const extractResult = extractMaskFromMessage(responseMessageField.value);
      responseMessageField.value = extractResult.cleanMessage;
      if (Object.keys(extractResult.mask).length) {
        fillForm(normalizeMaskByAccess(extractResult.mask));
      } else if (topicMaskState && topicMaskState.remember && topicMaskState.mask && !fromEdit
        && Object.keys(topicMaskState.mask).length) {
        fillForm(normalizeMaskByAccess(topicMaskState.mask));
      } else {
        clearMask();
      }

      ensureLayer();
      mountChip(form);
      if (!responseMessageField.dataset.hvInputBind) {
        responseMessageField.dataset.hvInputBind = '1';
        responseMessageField.addEventListener('input', () => renderIndicator());
      }
      refreshUi();

      let isPreparingMask = false;

      function prepareMaskForPost() {
        if (isPreparingMask) return;
        injectMaskToMessage();
        if (!fromEdit) {
          syncTopicMaskOnSubmit();
          if (persistOnSubmit) {
            persistMaskToUserStorage(getEffectiveMask());
          }
        }
        isPreparingMask = true;
        setTimeout(() => {
          isPreparingMask = false;
        });
      }

      if (!form.dataset.hvMaskSubmitBind) {
        form.dataset.hvMaskSubmitBind = '1';
        form.addEventListener('submit', function () {
          prepareMaskForPost();
        }, true);

        const ajaxPost = form.querySelector('.ajax-post') || document.querySelector('.ajax-post');
        if (ajaxPost) {
          ajaxPost.addEventListener('click', () => {
            prepareMaskForPost();
          }, true);
        }
      }
    }

    function getStrMask() {
      let str = '';
      Object.keys(tmpMask).forEach(change => {
        str += `[${tmpMask[change].tag}]${tmpMask[change].value}[/${tmpMask[change].tag}]`;
      });
      return `[block=hvmask]${str}[/block]`;
    }

    const SVG_NS = 'http://www.w3.org/2000/svg';
    const MATHML_NS = 'http://www.w3.org/1998/Math/MathML';
    const XLINK_NS = 'http://www.w3.org/1999/xlink';
    const HTML_NS = 'http://www.w3.org/1999/xhtml';

    const forbiddenTags = ['input', 'button', 'script', 'iframe', 'frame', 'frameset', 'style', 'audio', 'video',
      'form', 'footer', 'header', 'head', 'html', 'body', 'map', 'select', 'textarea', 'xmp', 'object', 'embed',
      'noembed', 'var', 'meta', 'animate', 'animatemotion', 'animatetransform', 'xss', 'main', 'aside', 'dialog',
      'noscript', 'noframes', 'title', 'set', 'use', 'base', 'math', 'link', 'template', 'portal', 'applet', 'slot',
      'plaintext', 'listing', 'source', 'track', 'param', 'fencedframe', 'handler', 'listener', 'discard',
      'foreignobject'];

    const forbiddenAttributes = ['id', 'name', 'form', 'formaction', 'action', 'srcdoc', 'autofocus',
      'contenteditable', 'popover', 'popovertarget', 'popovertargetaction', 'command', 'commandfor', 'is',
      'http-equiv', 'autoplay', 'ping', 'xmlns'];
    const urlAttributes = ['href', 'src', 'action', 'formaction', 'background', 'poster', 'data', 'codebase',
      'cite', 'longdesc', 'dynsrc', 'lowsrc', 'srcset', 'xlink:href'];

    let nativeSanitizer;

    // Sanitizer API
    function getNativeSanitizer() {
      if (nativeSanitizer !== undefined) return nativeSanitizer;
      nativeSanitizer = null;
      if (typeof window.Sanitizer !== 'function' || typeof Element.prototype.setHTML !== 'function') {
        return nativeSanitizer;
      }
      try {
        const removeElements = [];
        forbiddenTags.forEach(name => {
          removeElements.push({ name, namespace: HTML_NS });
          removeElements.push({ name, namespace: SVG_NS });
        });
        ['animateMotion', 'animateTransform', 'foreignObject'].forEach(name =>
          removeElements.push({ name, namespace: SVG_NS }));
        removeElements.push({ name: 'math', namespace: MATHML_NS });
        const removeAttributes = forbiddenAttributes
          .filter(name => name !== 'xmlns')
          .map(name => ({ name, namespace: null }));
        removeAttributes.push({ name: 'href', namespace: XLINK_NS });
        nativeSanitizer = new window.Sanitizer({ removeElements, removeAttributes, comments: false });
      } catch (e) {
        console.warn('hvScriptSet: Sanitizer API недоступен, используется встроенная проверка', e);
        nativeSanitizer = null;
      }
      return nativeSanitizer;
    }

    function isForbiddenUrl(element, value) {
      const url = value.replace(/[\u0000- \u007f-\u009f]/g, '').toLowerCase();
      if (/^(javascript|vbscript|livescript|mocha):/.test(url)) return true;
      if (url.startsWith('data:')) {
        return !(element.localName === 'img' && /^data:image\/(png|gif|jpe?g|webp|avif);/.test(url));
      }
      return false;
    }

    function isForbiddenAttribute(element, attr) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) return true;
      if (forbiddenAttributes.includes(name) || name.startsWith('xmlns:')) return true;
      if (urlAttributes.includes(name) || attr.localName === 'href') {
        return name === 'srcset'
          ? attr.value.split(',').some(part => isForbiddenUrl(element, part.trim()))
          : isForbiddenUrl(element, attr.value);
      }
      if (name === 'style') {
        return /expression\s*\(|-moz-binding|behavior\s*:|javascript:/i.test(attr.value);
      }
      return false;
    }

    function parseInert(html) {
      const template = document.createElement('template');
      template.innerHTML = html;
      return template.content;
    }

    function findHtmlViolation(fragment) {
      const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_ELEMENT);
      while (walker.nextNode()) {
        const element = walker.currentNode;
        const tag = element.localName.toLowerCase();
        if (forbiddenTags.includes(tag)) return `опасный тег <${tag}>`;
        for (const attr of Array.from(element.attributes)) {
          if (isForbiddenAttribute(element, attr)) return `опасный атрибут ${attr.name} в теге <${tag}>`;
        }
      }
      return null;
    }

    function hardenRendered(root) {
      root.querySelectorAll('[style]').forEach(element => {
        if (element.style.position === 'fixed') {
          element.style.removeProperty('position');
        }
      });
      root.querySelectorAll('a[href]').forEach(link => {
        link.setAttribute('rel', 'nofollow noopener noreferrer ugc');
      });
    }

    function checkHtml(html) {
      const violation = findHtmlViolation(parseInert(html));
      if (violation) console.error(violation);
      return violation;
    }

    /*
     * Безопасная вставка пользовательского html.
     */
    function setSafeHtml(element, html) {
      const fragment = parseInert(html);
      const violation = findHtmlViolation(fragment);
      if (violation) {
        console.error(violation);
        element.textContent = '';
        return violation;
      }
      const sanitizer = getNativeSanitizer();
      if (sanitizer) {
        element.setHTML(html, { sanitizer });
      } else {
        element.replaceChildren(fragment);
      }
      hardenRendered(element);
      return null;
    }

    function splitGraphemes(str) {
      if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
        return Array.from(new Intl.Segmenter('ru', { granularity: 'grapheme' }).segment(str), item => item.segment);
      }
      return Array.from(str);
    }

    function textLength(str) {
      return splitGraphemes(String(str)).length;
    }

    function truncateText(str, max) {
      const graphemes = splitGraphemes(String(str));
      return graphemes.length > max ? graphemes.slice(0, max).join('') : String(str);
    }

    function htmlToText(html) {
      return parseInert(html).textContent;
    }

    function unescapePostHtml(str) {
      return str.replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    }

    function escapeRegExp(str) {
      return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function escapeHtml(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function toJsUrlString(str) {
      return JSON.stringify(String(str)).replace(/%/g, '%25');
    }

    function bbcodeToHtml(str) {
      let tempStr = str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      const cssValue = '([#\\w\\s,.()%-]+?)';

      tempStr = tempStr.replace(/\n/gi, `<br />`);

      tempStr = tempStr.replace(new RegExp(`\\[font=${cssValue}\\](.*?)\\[\\/font\\]`, 'gi'), `<span style="font-family: $1">$2</span>`);
      tempStr = tempStr.replace(/\[size=(\d+?)\](.*?)\[\/size\]/gi, `<span style="font-size: $1px">$2</span>`);
      tempStr = tempStr.replace(/\[b\](.*?)\[\/b\]/gi, `<strong>$1</strong>`);

      tempStr = tempStr.replace(/\[i](.*?)\[\/i\]/gi, `<span style="font-style: italic">$1</span>`);
      tempStr = tempStr.replace(/\[u\](.*?)\[\/u\]/gi, `<em class="bbuline">$1</em>`);
      tempStr = tempStr.replace(/\[s\](.*?)\[\/s\]/gi, `<del>$1</del>`);

      tempStr = tempStr.replace(/\[align=(left|center|right)\](.*?)\[\/align\]/gi,
        `<span style="display: block; text-align: $1">$2</span>`);
      tempStr = tempStr.replace(/\[url=(https?:\/\/[^\s\]]*?)\](.*?)\[\/url\]/gi,
        `<a href="$1" rel="nofollow" target="_blank">$2</a>`);
      tempStr = tempStr.replace(/\[url\](https?:\/\/[^\s\[]*?)\[\/url\]/gi,
        `<a href="$1" rel="nofollow" target="_blank">$1</a>`);
      tempStr = tempStr.replace(new RegExp(`\\[color=${cssValue}\\](.*?)\\[\\/color\\]`, 'gi'), `<span style="color: $1">$2</span>`);

      tempStr = tempStr.replace(/\[img\](https?:\/\/[^\s\[]*?\.(?:jpg|png|jpeg|gif))\[\/img\]/gi, `<img class="postimg" src="$1" alt="$1">`);

      tempStr = tempStr.replace(/\[you\]/gi, escapeHtml(window.UserLogin));
      tempStr = tempStr.replace(/\[hr\]/gi, `<hr>`);
      tempStr = tempStr.replace(/\[sup\](.*?)\[\/sup\]/gi, `<sup>$1</sup>`);
      tempStr = tempStr.replace(/\[sub\](.*?)\[\/sub\]/gi, `<sub>$1</sub>`);
      tempStr = tempStr.replace(/\[mark\](.*?)\[\/mark\]/gi, `<span class="highlight-text">$1</span>`);
      tempStr = tempStr.replace(/\[abbr=&quot;(.*?)&quot;\](.*?)\[\/abbr\]/gi, `<abbr title="$1">$2</abbr>`);

      return tempStr;
    }

    function clearResponse(data) {
      const result = [];

      data.forEach(str => {
        try {
          // в 2025 году внутренний хостинг файлов mybb сменился, фикс автоматически заменяет ссылки
          const cleanSrt = str
            .replace(/https?:\/\/forumupload\.ru\//gi, 'https://upforme.ru/');
          JSON.parse(cleanSrt);
          result.push(cleanSrt);
        } catch (e) {
          console.error(`hvScriptSet: Маска неверно сохранилась и была удалена. Текст: ${str}`);
        }
      });

      return result;
    }

    function checkAccess() {
      if (!window.FORUM.topic) return false;
      if (!opt.forumAccess || window.GroupID === 1 || window.GroupID === 2) return true;

      let forumName = getClearedForumName(window.FORUM.topic.forum_name);

      return opt.forumAccess[forumName] ?
        opt.forumAccess[forumName].includes(window.GroupTitle) :
        false;
    }

    function checkAccessExtended() {
      if (!window.FORUM.topic) return false;
      if (window.GroupID === 1 || window.GroupID === 2) return true;
      if (!opt.forumAccessExtended) return false;

      let forumName = getClearedForumName(window.FORUM.topic.forum_name);

      return opt.forumAccessExtended[forumName] ?
        opt.forumAccessExtended[forumName].includes(window.GroupTitle) :
        false;
    }

    function getStorageMask() {
      const remote = fetchRemoteMasks();
      if (!remote.ok) {
        console.error('hvScriptSet: Не удалось загрузить список масок.');
        return;
      }
      prevMasks = remote.masks;
      refreshUi();
    }

    function saveMaskSettings(localSettings) {
      $.ajax({
        async: false,
        url: HVSS_URLS.api,
        data: {
          method: 'storage.get',
          key: 'profileMaskSettings',
          app_id: 16777215
        },
        success: function (result) {
          if (!result.error && result.response && result.response.storage && result.response.storage.data
            && result.response.storage.data.profileMaskSettings === JSON.stringify(localSettings)) {
            return; // настройки уже сохранены
          }

          $.post(HVSS_URLS.api, {
            method: 'storage.set',
            token: window.ForumAPITicket,
            key: 'profileMaskSettings',
            app_id: 16777215,
            value: JSON.stringify(localSettings)
          })
        }
      });
    }

    async function getMaskSettings() {
      const { response } = await $.get(HVSS_URLS.api, {
        method: 'storage.get',
        token: window.ForumAPITicket,
        key: 'profileMaskSettings',
        app_id: 16777215,
      });

      if (!response) {
        return;
      }

      const settings = response.storage?.data?.profileMaskSettings;
      if (!settings) {
        return;
      }
      try {
        return JSON.parse(settings);
      } catch (e) {
        return;
      }
    }

    function getClearedPost(post, chList) {
      let codeBoxes = post.innerHTML.match(/<div class="code-box"><strong class="legend">([\s\S]*?)?<\/strong><div class="blockcode"><div class="scrollbox" style="(?:.*?)"><pre>([\s\S]*?)?<\/pre><\/div><\/div><\/div>/gi) || [];
      let text = post.innerHTML.replace(/<div class="code-box"><strong class="legend">([\s\S]*?)?<\/strong><div class="blockcode"><div class="scrollbox" style="(?:.*?)"><pre>([\s\S]*?)?<\/pre><\/div><\/div><\/div>/gi, '|code-box-replacer|')
        .replace(/<dl class="post-sig">([\s\S]*?)?<\/dl>/g, '');
      Object.values(chList).forEach(item => {
        const tag = escapeRegExp(item.tag);
        text = text.replace(new RegExp('\\[' + tag + '\\]([\\s\\S]*?)\\[\\/' + tag + '\\]', 'gi'), '');
      });
      codeBoxes.forEach(box => {
        text = text.replace(/\|code-box-replacer\|/i, () => box);
      });
      return text;
    }

    function getClearedForumName(name) {
      return name[0] === String.fromCharCode(173) ?
        name.substr(1) // совместимость со скриптом подфорумов
        : name;
    }

    function getAccessByForumName() {
      if (window.GroupID === 1 || window.GroupID === 2) return 'extended';

      const crumbs = document.getElementById('pun-crumbs1');
      const crumbLinks = crumbs ? crumbs.querySelectorAll('a[href*="viewforum"]') : [];
      const link = crumbLinks[crumbLinks.length - 1];
      const name = link ? getClearedForumName(link.textContent) : '';

      if (opt.forumAccessExtended && opt.forumAccessExtended[name]) {
        if (opt.forumAccessExtended[name].includes(window.GroupTitle)) {
          return 'extended';
        }
      }
      if (opt.forumAccess && opt.forumAccess[name]) {
        if (opt.forumAccess[name].includes(window.GroupTitle)) {
          return 'common';
        }
      }
      if (!opt.forumAccess && window.GroupID !== 3) {
        return 'common';
      }

      return null;
    }

    function init() {
      if (that.inited) return;
      getStyle();
      if (window.FORUM.topic) {
        getPosts();
        if (window.GroupID !== 3) {
          getDialog();
          if (window.FORUM.editor) {
            initResponsePreview();
          }
        }
      } else if (!window.FORUM.topic && window.FORUM.editor) {
        if (window.GroupID !== 3) {
          getDialog();
          initResponsePreview();
        }
        hidePreviewTags();
      } else {
        hideTags();
      }
      that.inited = true;
    }

    if (!options || document.readyState !== 'loading') {
      init();
    } else {
      document.addEventListener('DOMContentLoaded', () => init());
    }
    $(document).on('pun_post', () => {
      getPosts();
      restoreMaskAfterPost();
    });
    $(document).on('pun_edit', () => getPosts());
    $(document).on('pun_preview', () => hidePreviewTags());
    $(document).on('pun_preedit', () => {
      initResponsePreview(true);
      hidePreviewTags();
    });
  }
};

/**
 * Если на форуме подключён HvScriptManager — подтянуть форму настроек маски.
 */
(function loadProfileMaskSettingsForm() {
  const MASK_SETTINGS_SRC = 'https://forumstatic.ru/files/0017/95/29/45711.js';
  let requested = false;

  function alreadyPresent() {
    if (document.querySelector('script[src*="45711.js"]')) {
      return true;
    }
    const mgr = window.HvScriptManager;
    if (mgr && typeof mgr.list === 'function') {
      try {
        return mgr.list().some(function (form) {
          return form && form.id === 'profile-mask';
        });
      } catch (e) {
        return false;
      }
    }
    return false;
  }

  function tryLoad() {
    if (requested) {
      return true;
    }
    if (alreadyPresent()) {
      requested = true;
      return true;
    }
    if (!window.HvScriptManager) {
      return false;
    }
    requested = true;
    const script = document.createElement('script');
    script.src = MASK_SETTINGS_SRC;
    script.async = true;
    (document.head || document.documentElement).appendChild(script);
    return true;
  }

  if (tryLoad()) {
    return;
  }

  // менеджер может появиться позже (другой порядок script)
  const timer = window.setInterval(function () {
    if (tryLoad()) {
      window.clearInterval(timer);
    }
  }, 100);
  window.setTimeout(function () {
    window.clearInterval(timer);
  }, 15000);
})();
