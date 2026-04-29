"use strict";

/**
 * hvScriptSet
 * Version: 1.0.24
 * Author: Человек-Шаман
 * license: MIT
 *
 * Что нового:
 * 1. Внутренний фикс
 */

const hvScriptSet = {

  data: {},

  addMask: async function (options) {
    const opt = options || await getMaskSettings();

    if (!opt) {
      console.error('Настройки скрипта маски не определены');
      return;
    }

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
        description: 'Прямая ссылка на картинку формата jpg, gif или png',
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

    let tmpMask = {};
    let previewForm = {};
    let errorList = {};

    const userFields = opt.userFields || ['pa-author', 'pa-title', 'pa-avatar', 'pa-fld1', 'pa-reg',
      'pa-posts', 'pa-respect', 'pa-positive', 'pa-awards', 'pa-gifts'];
    const allTagsList = getTagList();

    const defaultAvatar = opt.defaultAvatar || 'https://i.imgur.com/bQuC3S1.png';

    const maskLimit = opt.maskLimit || 20;

    const canQuoteMask = !opt.disableQuote;

    let prevMasks = [];

    getStorageMask();

    let posts = [];

    function getPosts() {
      posts = document.querySelectorAll('.post');
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
          changedPosts[_i].username = checkAccess[changedPosts[_i].userId].username;
          changedPosts[_i].groupId = checkAccess[changedPosts[_i].userId].groupId;
          changedPosts[_i].groupTitle = checkAccess[changedPosts[_i].userId].groupTitle;
          changedPosts[_i].access = checkAccess[changedPosts[_i].userId].access;

          if (changedPosts[_i].changeList.avatar && changedPosts[_i].access.common) {
            if (!changedPosts[_i].profile.querySelector('.pa-avatar img')) {
              let fieldIndex = userFields.indexOf('pa-avatar');
              let block = document.createElement('li');
              block.className = 'pa-avatar';
              block.innerHTML = `<img src="" title="${changedPosts[_i].username}">`;
              for (let index = ++fieldIndex; index <= userFields.length; index++) {
                let nextSibling = changedPosts[_i].profile.querySelector('.' + userFields[index]);
                if (nextSibling) {
                  let parent = nextSibling.parentNode;
                  parent.insertBefore(block, nextSibling);
                  break;
                }
                if (index === userFields.length) {
                  changedPosts[_i].profile.appendChild(block);
                }
              }
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
                let _fieldIndex = userFields.indexOf(changedPosts[_i].changeList[change].field);
                let _block = document.createElement('li');
                _block.className = thisChanges[change].field;
                for (let _index = ++_fieldIndex; _index <= userFields.length; _index++) {
                  let _nextSibling = changedPosts[_i].profile.querySelector('.' + userFields[_index]);
                  if (_nextSibling) {
                    let parent = _nextSibling.parentNode;
                    parent.insertBefore(_block, _nextSibling);
                    break;
                  }
                  if (_index === userFields.length) {
                    changedPosts[_i].profile.appendChild(_block);
                  }
                }
              }
              let fieldEl = changedPosts[_i].profile.getElementsByClassName(changedPosts[_i]
                .changeList[change].field)[0];
              switch (changedPosts[_i].changeList[change].type) {
                case 'html':
                  let content = strToHtml(changedPosts[_i].changeList[change].content);
                  if (content === '') {
                    console.error(`Что-то не так с маской в посте #${changedPosts[_i].postId}`);
                    if (window.GroupID === 1 || window.GroupID === 2) {
                      let errorMess = document.getElementById('admin_msg1');
                      if (errorMess) {
                        errorMess.innerHTML = `Что-то не так с маской в посте #${changedPosts[_i].postId}. Он подсвечен красным.<br><i>Сообщение показано только администрации.</i>`;
                        errorMess.style.display = 'block';
                        errorMess.style.zIndex = 10000;
                      };
                      document.getElementById(changedPosts[_i].postId)
                          .style.border = 'solid 1px #f00';
                    }
                  }
                  fieldEl.innerHTML = content.length > 999 ? content.slice(0, 999) : content;
                  break;
                case 'bbcode':
                  let __content = changedPosts[_i].changeList[change].content;
                  fieldEl.innerHTML = __content.length > 999 ? __content.slice(0, 999) : __content;
                  break;
                case 'text':
                  let _content = changedPosts[_i].changeList[change].content
                    .replace(/</i, '&lt').replace(/>/i, '&rt');
                  switch (change) {
                    case 'author':
                      fieldEl.innerHTML = _content.length > 25 ? _content.slice(0, 25) : _content;
                      if (!canQuoteMask) break;
                      $(`#${changedPosts[_i].postId}`).find('.pl-quote a').attr('href', "javascript:quote('" + _content.replace(/\'/i, '\\\'') + "', " + changedPosts[_i].postId.slice(1) + ")");
                      break;
                    case 'title':
                      fieldEl.innerHTML = _content.length > 50 ? _content.slice(0, 50) : _content;
                      break;
                    default:
                      fieldEl.innerHTML = _content.length > 999 ? _content.slice(0, 999) : _content;
                  }
                  break;
                case 'link':
                  var linkContent = changedPosts[_i].changeList[change].content.length > 25 ?
                    changedPosts[_i].changeList[change].content.slice(0, 25) :
                    changedPosts[_i].changeList[change].content
                  fieldEl.querySelector('a').textContent = linkContent;

                  if (change === 'author' && canQuoteMask) {
                    const nickLink = fieldEl.querySelector('a');
                    nickLink.href = nickLink.href.includes('profile')
                      ? nickLink.href
                      : "javascript:to('" + linkContent.replace(/\'/i, '\\\'') + "')";
                    $('#' + changedPosts[_i].postId).find('.pl-quote a').attr('href', "javascript:quote('" + linkContent.replace(/\'/i, '\\\'') + "', " + changedPosts[_i].postId.slice(1) + ")");
                  }
                  break;
                case 'signature':
                  if (window.GroupID !== '3') {
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
      posts = document.querySelectorAll('.post');
      posts.forEach(post => {
        const hiddenBlock = post.querySelector('.hvmask');
        if (hiddenBlock) return;
        const text = post.querySelector('.post-content');
        allTagsList.forEach(tag => {
          let pattern =
            new RegExp('\\[' + tag + '\\](.*?)\\[\/' + tag + '\\]', 'gi');
          text.innerHTML = text.innerHTML.replace(pattern, '');
        })
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
      for (let field in changeList) {
        if (changeList.hasOwnProperty(field)) {
          let tags = changeList[field].tag.split(',');
          for (let i = tags.length; i >= 0; i--) {
            if (tags.hasOwnProperty(i)) {
              let pattern = new RegExp('\\[' + tags[i] + '\\]([\\s\\S]*?)\\[\\/' + tags[i] + '\\]', 'gmi');
              let clearPattern = new RegExp('\\[(\\/?)' + tags[i] + '\\]', 'gmi');
              if (clearedText.match(pattern)) {
                postChangeList[field] = {
                  'tag': tags[i],
                  'field': changeList[field].class,
                  'content': clearedText.match(pattern)[0].replace(clearPattern, ''),
                  'type': changeList[field].type
                };
              }
            }
          }
        }
      }
      return postChangeList;
    }

    function getTagList() {
      let tagList = [];
      for (let field in changeList) {
        if (changeList.hasOwnProperty(field)) {
          let tags = changeList[field].tag.split(',');
          for (let i in tags) {
            if (tags.hasOwnProperty(i) && !tagList.indexOf(tags[i]) + 1) {
              tagList.push(tags[i]);
            }
          }
        }
      }
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
          url: '/api.php',
          data: {
            method: 'users.get',
            user_id: usersIdStr
          },
          success: function success(json) {
            for (let i in json.response.users) {
              if (json.response.users.hasOwnProperty(i)) {
                usersInfo[json.response.users[i].user_id] = {
                  'userId': i,
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

    function getDialog() {
      let maskButton = addButton();
      if (maskButton) {
        if (checkAccessExtended() || getAccessByForumName() === 'extended') {
          maskButton.addEventListener('click', (event) => {
            if (event.ctrlKey || event.metaKey) {
              insertAvatarTags();
            } else {
              callMaskDialog();
            }
          });
        } else {
          maskButton.addEventListener('click', insertAvatarTags);
        }
      }
      let maskDialog = buildMaskDialog();
      let main = document.querySelector('#pun-main');
      main.appendChild(maskDialog);
    }

    function getStyle() {
      let style = document.createElement('link');
      style.rel = 'stylesheet';
      style.href = 'https://forumstatic.ru/files/0017/95/29/74324.css';

      let docstyle = document.head.querySelector('link[href*="style"]');
      document.head.insertBefore(style, docstyle);
    }

    function insertAvatarTags() {
      bbcode('[icon]', '[/icon]');
    }

    function setSelectionRange(input, selectionStart, selectionEnd) {
      if (input.setSelectionRange) {
        input.focus();
        input.setSelectionRange(selectionStart, selectionEnd);
      } else if (input.createTextRange) {
        let range = input.createTextRange();
        range.collapse(true);
        range.moveEnd('character', selectionEnd);
        range.moveStart('character', selectionStart);
        range.select();
      }
    }

    function changeMaskForm(field, value) {
      let str = '';
      switch (field) {
        case 'signature':
          break;
        case 'avatar':
          str = value !== '' ? value : getAvatar();
          if (!checkImage(str)) {
            errorList[field] = 'В поле [Аватар] должна быть ссылка на картинку формата jpg, gif или png';
          } else {
            delete errorList[field];
            previewForm.querySelector(`.hv-preview-${field} img`).src = str;
          }
          break;
        case 'author':
          if (value.length > 25) {
            errorList[field] = 'Поле [Ник] не должно содержать больше 25 символов';
          } else {
            str = value !== '' ? value : window.UserLogin;
            delete errorList[field];
            previewForm.querySelector(`.hv-preview-${field}`).innerText = str;
          }
          break;
        case 'title':
          if (value.length > 50) {
            errorList[field] = 'Поле [Статус] не должно содержать больше 50 символов';
          } else {
            delete errorList[field];
            str = value !== '' ? value : getUserTitle();
            previewForm.querySelector(`.hv-preview-${field}`).innerText = str;
          }
          break;
        default:
          if (value.length > 999) {
            errorList[field] = `Поле [${changeList[field].title}] не должно содержать больше 999 символов`;
          } else {
            delete errorList[field];
            str = value || '';
            switch (changeList[field].type) {
              case 'text':
                delete errorList[field];
                previewForm.querySelector(`.hv-preview-${field}`).innerHTML = str.replace(/</gi, '&lt;');
                break;
              case 'bbcode':
                delete errorList[field];
                previewForm.querySelector(`.hv-preview-${field}`).innerHTML = bbcodeToHtml(str);
                break;
              default:
                if (checkHtml(str)) {
                  errorList[field] = `В поле [${changeList[field].title}] недопустимые теги`;
                } else {
                  delete errorList[field];
                  previewForm.querySelector(`.hv-preview-${field}`).innerHTML = str;
                }
            }
          }
          break;
      }
      showErrors();
    }

    function showErrors() {
      let errorListBlock = document.querySelector('#mask_dialog .hv-error-list');
      errorListBlock.innerHTML = '';
      if (Object.keys(errorList).length) {
        errorListBlock.style.display = 'block';
        for (let error in errorList) {
          if (errorList.hasOwnProperty(error)) {
            let li = document.createElement('li');
            li.innerHTML = `<li> ! ${errorList[error]}</li>`;
            errorListBlock.appendChild(li);
          }
        }
      } else {
        errorListBlock.style.display = 'none';
      }
    }

    function fillForm(obj) {
      let form = document.querySelector('#mask_form');
      for (let change in changeList) {
        if (changeList.hasOwnProperty(change)) {
          let field = form.querySelector('#mask_' + change);
          if (obj[change]) {
            field.value = obj[change].value;
            tmpMask[change] = {
              'tag': obj[change].tag,
              'value': obj[change].value
            };
            changeMaskForm(change, obj[change].value);
          } else {
            field.value = '';
            delete tmpMask[change];
            changeMaskForm(change, '');
          }
        }
      }
    }

    function getAvatar() {
      return window.UserAvatar ? window.UserAvatar : defaultAvatar;
    }

    function getUserTitle() {
      return window.UserTitle ? window.UserTitle : 'Статус';
    }

    function addButton() {
      let form = document.getElementById("form-buttons");
      if (form && (checkAccess() || checkAccessExtended() || getAccessByForumName())) {
        let button = document.createElement('td');
        button.id = 'button-mask';
        button.title = 'Маска профиля';
        button.innerHTML = '<img src="/i/blank.gif">';
        let bgImage = opt.buttonImage ? opt.buttonImage : 'https://i.imgur.com/ONu0llO.png';
        button.style.backgroundImage = 'url("' + bgImage + '")';
        form.getElementsByTagName('tr')[0].appendChild(button);
        return button;
      } else {
        return null;
      }
    }

    function callMaskDialog() {
      let maskDialog = document.getElementById('mask_dialog');
      maskDialog.style.display = 'block';
      getMaskStorage(prevMasks);
      document.addEventListener('keyup', hideMaskByEsc);
    }

    function hideMaskDialog() {
      let maskDialog = document.getElementById('mask_dialog');
      maskDialog.style.display = 'none';
      document.removeEventListener('keyup', hideMaskByEsc);
    }

    function hideMaskByEsc(e) {
      if (e.keyCode === 27) hideMaskDialog();
    }

    function buildMaskDialog() {
      let code = document.createElement('div');
      code.id = 'mask_dialog';
      code.style.display = 'none';

      let bg = document.createElement('div');
      bg.className = 'hv-bg';

      bg.addEventListener('click', event => {
        if (event.target === bg) {
          hideMaskDialog();
        }
      });

      let inner = document.createElement('div');
      inner.className = 'inner container';

      let title = document.createElement('div');
      title.className = 'hv-mask-dialog-title';
      title.innerHTML = 'Маска профиля';

      let errorListBlock = document.createElement('ul');
      errorListBlock.className = 'hv-error-list';
      errorListBlock.style.display = 'none';

      let showPreviewFlag = opt.showPreview || true;

      let preview = document.createElement('div');
      previewForm = preview;
      preview.className = 'hv-preview-block';
      clearPreview();

      let form = document.createElement('form');
      form.id = 'mask_form';

      let previewMaskForm = document.createElement('form');
      previewMaskForm.id = 'hv_preview_form';
      previewMaskForm.style.display = 'none';

      let previewFormSent = document.createElement('input');
      previewFormSent.type = 'hidden';
      previewFormSent.name = 'form_sent';
      previewFormSent.value = 1;
      let previewFormUser = document.createElement('input');
      previewFormUser.type = 'hidden';
      previewFormUser.name = 'form_user';
      previewFormUser.value = window.UserLogin;
      let previewReqMessage = document.createElement('textarea');
      previewReqMessage.name = 'req_message';
      previewMaskForm.appendChild(previewFormSent);
      previewMaskForm.appendChild(previewFormUser);
      previewMaskForm.appendChild(previewReqMessage);

      let _loop = function _loop(mask) {
        if (changeList.hasOwnProperty(mask)) {
          (function () {
            let li = document.createElement('div');
            li.className = 'hv-mask-field ' + mask;
            let input = void 0;
            switch (changeList[mask].type) {
              case 'html':
              case 'signature':
              case 'bbcode':
                input = document.createElement('textarea');
                input.id = 'mask_' + mask;
                break;
              default:
                input = document.createElement('input');
                input.type = 'text';
                input.id = 'mask_' + mask;
            }
            input.addEventListener('blur', () => {
              let idField = input.id.split('mask_')[1];
              if (input.value !== '' && !checkHtml(input.value)) {
                tmpMask[idField] = {
                  'tag': changeList[idField].tag.split(',')[0],
                  'value': input.value
                };
              } else {
                delete tmpMask[idField];
              }
              changeMaskForm(idField, input.value);
            });
            let label = document.createElement('label');
            label.for = 'mask_' + mask;

            label.innerHTML += '<b>' + changeList[mask].title + '</b>';
            if (changeList[mask].description) {
              label.innerHTML += '<div class="description">' + changeList[mask].description + '</div>';
            }
            li.appendChild(label);
            if (changeList[mask].defaultCode) {
              const code = changeList[mask].defaultCode;

              if (typeof code === 'string') {
                let templateButton = document.createElement('div');
                templateButton.className = 'button hv-add-template';
                templateButton.innerText = '« вставить шаблон';
                templateButton.title = 'Вставить шаблон';
                templateButton.addEventListener('click', function () {
                  fillInput(input, changeList[mask].defaultCode);
                  changeMaskForm(mask, input.value);
                });
                label.insertBefore(templateButton, label.querySelector('b'));
              }

              if (Array.isArray(code)) {
                const templateSelect = document.createElement('select');
                templateSelect.className = 'button hv-add-template';
                const defaultOption = document.createElement('option');
                defaultOption.value = '';
                defaultOption.selected = true;
                defaultOption.text = 'Вставить шаблон';
                templateSelect.appendChild(defaultOption);
                code.forEach(item => {
                  const option = document.createElement('option');
                  option.value = item.template;
                  option.text = item.name;
                  templateSelect.appendChild(option);
                });
                templateSelect.addEventListener('change', event => {
                  const value = event.target.value;
                  fillInput(input, value);
                  changeMaskForm(mask, input.value);
                })
                label.insertBefore(templateSelect, label.querySelector('b'));
              }
            }
            li.appendChild(input);
            form.appendChild(li);
          })();
        }
      };

      for (let mask in changeList) {
        _loop(mask);
      }

      let formBlock = document.createElement('div');
      formBlock.className = 'hv-form-block';
      formBlock.appendChild(form);
      formBlock.appendChild(previewMaskForm);

      let userMasks = document.createElement('ul');
      userMasks.className = 'hv-masks-storage';
      userMasks.classList.toggle('hidden', prevMasks.length === 0);

      let block = document.createElement('div');
      block.className = 'hv-mask-block';
      if (showPreviewFlag) {
        block.appendChild(preview);
      }
      block.appendChild(formBlock);
      block.appendChild(userMasks);

      let okButton = document.createElement('input');
      okButton.type = 'button';
      okButton.className = 'button';
      okButton.name = 'insertMask';
      okButton.value = 'Вставить маску';
      okButton.addEventListener('click', saveMask);

      let insertButton = document.createElement('input');
      insertButton.type = 'button';
      insertButton.className = 'button';
      insertButton.name = 'insertMask';
      insertButton.value = 'Вставить без сохранения';
      insertButton.addEventListener('click', insertMask);

      let clearButton = document.createElement('input');
      clearButton.type = 'button';
      clearButton.className = 'button';
      clearButton.name = 'clearMask';
      clearButton.value = 'Очистить';
      clearButton.addEventListener('click', clearMask);

      let cancelButton = document.createElement('input');
      cancelButton.type = 'button';
      cancelButton.className = 'button';
      cancelButton.name = 'cancelMask';
      cancelButton.value = 'Отмена';
      cancelButton.addEventListener('click', cancelMask);

      let control = document.createElement('div');
      control.className = 'hv-control';
      control.appendChild(okButton);
      control.appendChild(insertButton);
      control.appendChild(clearButton);
      control.appendChild(cancelButton);

      inner.appendChild(title);
      inner.appendChild(errorListBlock);
      inner.appendChild(block);
      inner.appendChild(control);

      code.appendChild(bg);
      bg.appendChild(inner);

      return code;
    }

    function getMaskStorage(prevMasks) {
      const maskDialog = document.getElementById('mask_dialog');
      if (!maskDialog) return;
      let maskStore = maskDialog.querySelector('.hv-masks-storage');
      maskStore.classList.toggle('hidden', prevMasks.length === 0);
      maskStore.innerHTML = `<div class="hv-storage-count">масок: ${prevMasks.length}/${maskLimit}</div>`;

      let _loop2 = function _loop2(mask) {
        let mymask = JSON.parse(prevMasks[mask]);
        let li = document.createElement('li');
        li.className = 'hv-mask-element';
        let tempavatar = mymask['avatar'] ? mymask['avatar'].value : defaultAvatar;
        let avatar = document.createElement('img');
        avatar.src = tempavatar;
        let infoBlock = '';

        for (let item in changeList) {
          if (changeList.hasOwnProperty(item) && item !== 'avatar' && mymask[item]) {
            if (!checkHtml(mymask[item].value.toString())) {
              infoBlock += '<div class="' + item + '"><b>' + changeList[item].title + ':</b> ' +
                mymask[item].value + '</div>';
            }
          }
        }

        let deleteMask = document.createElement('a');
        deleteMask.className = 'hv-delete-mask';
        deleteMask.innerText = 'Удалить';
        deleteMask.title = 'Удалить маску из списка';
        deleteMask.addEventListener('click', () => deleteMaskFromStorage(mask, li));
        li.appendChild(avatar);
        if ((mymask['avatar'] && Object.keys(mymask).length > 1) ||
          (!mymask['avatar'] && Object.keys(mymask).length > 0)) {
          li.dataset.content = infoBlock;
          $(li).tipsy({
            title: function() { return `<div class="hv-mask-tipsy">${this.getAttribute('data-content')}</div>`; },
            fade: true,
            html: true,
            gravity: 'e',
            className: 'hv-mask-tooltipsy'
          });
        } else {
          $(li).tipsy();
        }
        li.appendChild(deleteMask);
        avatar.addEventListener('click', () => fillForm(mymask));
        maskStore.appendChild(li);
      };

      for (let mask = prevMasks.length - 1; mask >= 0; mask--) {
        _loop2(mask);
      }
    }

    function fillInput(input, value) {
      input.value = value;
    }

    function insertMask () {
      insert(getStrMask());
      clearMask();
      hideMaskDialog();
    }

    function saveMask() {
      if (Object.keys(tmpMask).length > 0) {
        if (Object.keys(prevMasks).length > 0) {
          if (!(hasMaskInStorage(prevMasks, tmpMask) + 1)) {
            if (prevMasks.length >= maskLimit) {
              prevMasks.splice(0, 1);
            }
          } else {
            prevMasks.splice(hasMaskInStorage(prevMasks, tmpMask), 1);
          }
        }
        prevMasks.push(JSON.stringify(tmpMask));

        const value = encodeURI(prevMasks.join('|splitKey|'));
        if (value.length >= 65500) {
          $.jGrowl("Хранилище масок переполнено, не могу сохранить ещё маску 😔");
          throw new Error('Ошибка сохранения');
        }

        $.post('/api.php',
          {
            method: 'storage.set',
            token: window.ForumAPITicket,
            key: 'maskListUser',
            value,
          }
        )
          .done(function() {
            insert(getStrMask());
            getMaskStorage(prevMasks);
            clearMask();
            hideMaskDialog();
          })
          .fail(function() {
            errorList.common = 'Ошибка сохранения, попробуй ещё раз.';
            showErrors();
          });
      }
    }

    function hasMaskInStorage(storage, item) {
      let res = -1;
      for (let i = 0; i < storage.length; i++) {
        let obj = JSON.parse(storage[i]);
        if (Object.keys(obj).length === Object.keys(item).length) {
          let counter = 0;
          for (let k in obj) {
            if (obj.hasOwnProperty(k)) {
              if (JSON.stringify(obj[k]) !== JSON.stringify(item[k])) {
                break;
              } else {
                counter++;
              }
            }
            if (counter === Object.keys(obj).length) {
              res = i;
            }
          }
        }
      }
      return res;
    }

    function deleteMaskFromStorage(mask, li) {
      const isConfirmed = confirm('Точно удалить маску?');

      if (!isConfirmed) return;

      if ($(li).tipsy('getTitle')) {
        $(li).tipsy('hide');
      }
      prevMasks.splice(mask, 1);
      $.post('/api.php',
        {
          method: 'storage.set',
          token: window.ForumAPITicket,
          key: 'maskListUser',
          value: encodeURI(prevMasks.join('|splitKey|'))
        }
      );
      getMaskStorage(prevMasks);
    }

    function clearMask() {
      tmpMask = {};
      clearPreview();
      errorList = {};
      showErrors();
      let maskForm = document.getElementById('mask_form');
      maskForm.reset();
    }

    function cancelMask() {
      clearMask();
      hideMaskDialog();
    }

    function clearPreview() {
      previewForm.innerHTML = '';
      for (let mask in changeList) {
        if (changeList.hasOwnProperty(mask)) {
          const div = document.createElement('div');
          div.className = `hv-preview-${mask}`;
          switch (mask) {
            case 'author':
              div.innerHTML = window.UserLogin;
              previewForm.appendChild(div);
              break;
            case 'title':
              div.innerHTML = getUserTitle();
              previewForm.appendChild(div);
              break;
            case 'avatar':
              let src = getAvatar();
              div.innerHTML = '<img src="' + src + '">';
              previewForm.appendChild(div);
              break;
            case 'signature':
              break;
            default:
              div.innerHTML = '';
              previewForm.appendChild(div);
              break;
          }
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

    const forbiddenTags = ['input', 'button', 'script', 'iframe', 'frame', 'style', 'audio', 'video', 'form',
      'footer', 'header', 'head', 'html', 'map', 'select', 'textarea', 'xmp', 'object', 'embed', 'noembed',
      'var', 'meta', 'animate','xss','main','aside','dialog','noscript','noframes','title','set','use','base','math'];
    const forbiddenEvents = ['onblur', 'onchange', 'onclick', 'ondblclick', 'onfocus', 'onkeydown', 'onkeypress',
      'onkeyup', 'onload', 'onmousedown', 'onmousemove', 'onmouseout', 'onmouseover', 'onmouseup', 'onreset',
      'onselect', 'onscroll', 'onsubmit', 'onunload', 'javascript', 'onerror', 'oninput', 'onafterprint',
      'onbeforeprint', 'onbeforeunload', 'onhashchange', 'onmessage', 'onoffline', 'ononline', 'onpagehide',
      'onpageshow', 'onpopstate', 'onresize', 'onstorage', 'oncontextmenu', 'oninvalid', 'onreset', 'onsearch',
      'ondrag', 'ondragend', 'ondragenter', 'ondragleave', 'ondragover', 'ondragstart', 'ondrop', 'onmousedown',
      'onmousewheel', 'onwheel', 'oncopy', 'oncut', 'onpaste', 'onabort', 'oncanplay', 'oncanplaythrough',
      'oncuechange', 'ondurationchange', 'onemptied', 'onended', 'onerror', 'onloadeddata', 'onloadedmetadata',
      'onloadstart', 'onpause', 'onplay', 'onplaying', 'onprogress', 'onratechange', 'onseeked', 'onseeking',
      'onstalled', 'onsuspend', 'ontimeupdate', 'onvolumechange', 'onwaiting','onbegin','onanimationend',
      'onanimationiteration','onbeforescriptexecute','onbounce','onend','onfocusin','onloadmetadata','onrepeat',
      'onscrollend','ontoggle','ontransitioncancel','ontransitionend','ontransitionrun','ontransitionstart',
      'onunhandledrejection','onwebkitanimationend','onwebkitanimationiteration','onwebkitanimationstart',
      'onwebkittransitionend','onauxclick','onbeforecopy','contentEditable','onbeforecut','popovertarget',
      'onbeforetoggle','autofocus','drarrable','onfullscreenchange','required','onmouseleave','autoplay','onpointerdown',
      'onpointerenter','onpointerleave','onpointermove','onpointerout','onpointerover','onpointerrawupdate','onpointerup',
      'onselectionchange','onselectstart','contextmenu','ontouched','ontouchmove','ontouchstart'];

    function strToHtml(str) {
      let forbiddenTag = '';
      let forbiddenTagsCheck = false;
      for (let i = 0; i < forbiddenTags.length; i++) {
        let pattern = new RegExp('(<|&lt;)' + forbiddenTags[i]);
        forbiddenTagsCheck = pattern.exec(str);
        if (forbiddenTagsCheck) {
          forbiddenTag = forbiddenTagsCheck[0].replace('&lt;', '');
          console.error(`Forbidden tag <${forbiddenTag}> in mask`);
          return '';
        }
      }
      for (let _i2 = 0; _i2 < forbiddenEvents.length; _i2++) {
        let _pattern = new RegExp(forbiddenEvents[_i2] + '=');
        forbiddenTagsCheck = _pattern.exec(str);
        if (forbiddenTagsCheck) {
          forbiddenTag = forbiddenTagsCheck[0].replace('&lt;', '');
          console.error(`Forbidden event <${forbiddenTag}> in mask`);
          return '';
        }
      }
      let check = /&lt;(.*?)?( xlink:| id=(.*?)?)/.test(str);
      if (check) {
        console.error('Forbidden tag properties in mask');
      }
      return check ? '' : str.replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    }

    function bbcodeToHtml(str) {
      let tempStr = str.replace(/</gi, '&lt;');

      tempStr = tempStr.replace(/\n/gi, `<br />`);

      tempStr = tempStr.replace(/\[font=(.*?)\](.*?)\[\/font\]/gi, `<span style="font-family: $1">$2</span>`);
      tempStr = tempStr.replace(/\[size=(\d*?)\](.*?)\[\/size\]/gi, `<span style="font-family: $1px">$2</span>`);
      tempStr = tempStr.replace(/\[b\](.*?)\[\/b\]/gi, `<strong>$1</strong>`);

      tempStr = tempStr.replace(/\[i](.*?)\[\/i\]/gi, `<span style="font-style: italic">$1</span>`);
      tempStr = tempStr.replace(/\[u\](.*?)\[\/u\]/gi, `<em class="bbuline">$1</em>`);
      tempStr = tempStr.replace(/\[s\](.*?)\[\/s\]/gi, `<del>$1</del>`);

      tempStr = tempStr.replace(/\[align=([left|center|right]*?)\](.*?)\[\/align\]/gi,
        `<span style="display: block; text-align: $1">$2</span>`);
      tempStr = tempStr.replace(/\[url=(https?:\/\/.*?)\](.*?)\[\/url\]/gi,
        `<a href="$1" rel="nofollow" target="_blank">$2</a>`);
      tempStr = tempStr.replace(/\[url\](https?:\/\/.*?)\[\/url\]/gi,
        `<a href="$1" rel="nofollow" target="_blank">$1</a>`);
      tempStr = tempStr.replace(/\[color=(.*?)\](.*?)\[\/color\]/gi, `<span style="color: $1">$2</span>`);

      tempStr = tempStr.replace(/\[img\](https?:\/\/.*?\.(?:jpg|png|jpeg|gif))\[\/img\]/gi, `<img class="postimg" src="$1" alt="$1">`);

      tempStr = tempStr.replace(/\[you\]/gi, window.UserLogin);
      tempStr = tempStr.replace(/\[hr\]/gi, `<hr>`);
      tempStr = tempStr.replace(/\[sup\](.*?)\[\/sup\]/gi, `<sup>$1</sup>`);
      tempStr = tempStr.replace(/\[sub\](.*?)\[\/sub\]/gi, `<sub>$1</sub>`);
      tempStr = tempStr.replace(/\[mark\](.*?)\[\/mark\]/gi, `<span class="highlight-text">$1</span>`);
      tempStr = tempStr.replace(/\[abbr="(.*?)"\](.*?)\[\/abbr\]/gi, `<abbr title="$1">$2</abbr>`);

      return tempStr;
    }

    function checkHtml(html) {
      let forbiddenTagsCheck = false;
      for (let i = 0; i < forbiddenTags.length; i++) {
        let pattern = new RegExp('(<|&lt;)' + forbiddenTags[i]);
        forbiddenTagsCheck = pattern.exec(html);
        if (forbiddenTagsCheck) return true;
      }
      for (let _i3 = 0; _i3 < forbiddenEvents.length; _i3++) {
        let _pattern2 = new RegExp(forbiddenEvents[_i3] + '=');
        forbiddenTagsCheck = _pattern2.exec(html);
        if (forbiddenTagsCheck) return true;
      }
      return forbiddenTagsCheck;
    }

    function checkImage(src) {
      return (/\.jpg|\.png|\.gif/.test(src));
    }

    function clearResponse(data) {
      const result = [];

      data.forEach(str => {
        try {
          // в 2025 году внутренний хостинг файлов mybb сменился, фикс автоматически заменяет ссылки
          const cleanSrt = str
            .replace(/https?:\/\/forumupload.ru\//gi, 'https://upforme.ru/');
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
      $.ajax({
        async: false,
        url: '/api.php',
        data: {
          method: 'storage.get',
          key: 'maskListUser'
        },
        success: function (result) {
          const response = result.response;

          if (response) {
            let data;
            try {
              data = decodeURI(response.storage.data.maskListUser).split('|splitKey|');
            } catch (e) {
              data = response.storage.data.maskListUser.split('|splitKey|');
            }
            prevMasks = clearResponse(data);
            getMaskStorage();
          }
        }
      });
    }

    function saveMaskSettings(localSettings) {
      $.ajax({
        async: false,
        url: '/api.php',
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

          $.post('/api.php', {
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
      const { response } = await $.get('/api.php', {
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
      let codeBoxes = post.innerHTML.match(/<div class="code-box"><strong class="legend">([\s\S]*?)?<\/strong><div class="blockcode"><div class="scrollbox" style="(?:.*?)"><pre>([\s\S]*?)?<\/pre><\/div><\/div><\/div>/gi, '|code-box-replacer|');
      let text = post.innerHTML.replace(/<div class="code-box"><strong class="legend">([\s\S]*?)?<\/strong><div class="blockcode"><div class="scrollbox" style="(?:.*?)"><pre>([\s\S]*?)?<\/pre><\/div><\/div><\/div>/gi, '|code-box-replacer|')
        .replace(/<dl class="post-sig">([\s\S]*?)?<\/dl>/g, '');
      for (let ch in chList) {
        if (chList.hasOwnProperty(ch)) {
          let pattern = new RegExp('\\[' + chList[ch].tag + '\\]([\\s\\S]*?)\\[\/' + chList[ch].tag + '\\]', 'gi');
          text = text.replace(pattern, '');
        }
      }
      for (let i in codeBoxes) {
        text = text.replace(/\|code-box-replacer\|/i, codeBoxes[i]);
      }
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
      const crumbLinks = crumbs.querySelectorAll('a[href*="viewforum"]');
      const link = crumbLinks[crumbLinks.length-1];
      let name = link.textContent;
      name = getClearedForumName(name);

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
        }
      } else if (!window.FORUM.topic && window.FORUM.editor) {
        if (window.GroupID !== 3) {
          getDialog();
        }
        hidePreviewTags();
      } else {
        hideTags();
      }
      that.inited = true;
    }

    if (!options) {
      init();
    }
    document.addEventListener('DOMContentLoaded', () => init());
    $(document).on('pun_post', () => getPosts());
    $(document).on('pun_edit', () => getPosts());
    $(document).on('pun_preview', () => hidePreviewTags());
    $(document).on('pun_preedit', () => hidePreviewTags());
  }
};
