/*
 * Copyright 2018 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not
 * use this file except in compliance with the License. You may obtain a copy of
 * the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
 * License for the specific language governing permissions and limitations under
 * the License.
 */

const assert = self.assert;

const sources = new WeakMap();
window.addEventListener('message', (ev) => {
  const resolve = sources.get(ev.source);
  if (!resolve) {
    throw new TypeError('unexpected source');
  }
  resolve(ev.data);
});

/**
 * @param {!Object<string, *>} manifest
 * @param {string=} head
 * @param {!Object<string, *>} navigatorOverride
 * @param {number} delay
 * @return {!Promise<!DocumentFragment}
 */
function testManifest(manifest, head='', navigatorOverride={}, delay=25) {
  const rigsource = `
<!DOCTYPE html>
<html>
<head>
  <link rel="manifest" href="data:application/json;base64,${btoa(JSON.stringify(manifest))}" />
  ${head}
</head>
<body>
  <script type="module" async>
const navigatorOverride = ${JSON.stringify(navigatorOverride)};
for (const k in navigatorOverride) {
  Object.defineProperty(navigator, k, {value: navigatorOverride[k]});
}
const ready = new Promise((resolve) => {
  // const mo = new MutationObserver(() => resolve());
  // mo.observe(document.head, {childList: true});

  window.addEventListener('load', () => {
    // let pwacompat do its work
    // We have to wait, because there's no single moment we add everything to <head>.
    window.setTimeout(resolve, ${delay});
  });
});
ready.then(() => {
  const all = Array.from(document.head.children).map((el) => {
    const attr = {};
    for (let i = 0; i < el.attributes.length; ++i) {
      const raw = el.attributes[i];
      attr[raw.name] = raw.value;
    }
    return {name: el.localName, attr};
  });
  window.parent.postMessage(all, '*');
});
  </script>
  <script src="${window.location.origin}/src/pwacompat.js" defer></script>
</body>
</html>
  `;

  const iframe = document.createElement('iframe');
  iframe.hidden = true;
  iframe.src = `data:text/html;base64,${btoa(rigsource)}`;
  iframe.sandbox = 'allow-scripts';
  document.body.appendChild(iframe);

  const p = new Promise((resolve, reject) => {
    sources.set(iframe.contentWindow, resolve);
    window.setTimeout(reject, 500);
  });

  const cleanup = () => iframe.remove();
  p.then(cleanup, cleanup);

  return p.then((all) => {
    // rehydrate DOM
    const frag = document.createDocumentFragment();
    all.forEach(({name, attr}) => {
      const node = document.createElement(name);
      for (const n in attr) {
        node.setAttribute(n, attr[n]);
      }
      frag.appendChild(node);
    });
    return frag;
  });
}

suite('pwacompat', () => {
  test('theme_color', async () => {
    const manifest = {
      'theme_color': 'red',
    };
    let r = await testManifest(manifest);
    assert.isNotNull(r.querySelector('meta[name="theme-color"][content="red"]'));

    r = await testManifest(manifest, '<meta name="theme-color" content="blue" />');
    assert.isNotNull(r.querySelector('meta[name="theme-color"][content="blue"]'));
    assert.isNull(r.querySelector('meta[name="theme-color"][content="red"]'),
        'red should not be created');
  });

  test('icons', async () => {
    const manifest = {
      'icons': [
        {'src': 'logo-192.png', 'sizes': '192x192'},
        {'src': 'logo-128.png', 'sizes': '128x128'},
      ],
    };
    const r = await testManifest(manifest);
    assert.isNotNull(r.querySelector('link[rel="icon"][href="logo-128.png"][sizes="128x128"]'));
  });

  test('should add meta `mobile-web-app-capable`', async () => {
    const manifest = {
      display: 'standalone',
    };
    const r = await testManifest(manifest);
    assert.isNotNull(r.querySelector('meta[name="mobile-web-app-capable"][content="yes"]'));
  });

  test('should not add meta `mobile-web-app-capable` if it was present beforehand', async () => {
    const manifest = {
      display: 'standalone',  // pwacompat should add 'meta[name="mobile-web-app-capable"][content="yes"]'
    };
    const r = await testManifest(manifest, '<meta name="mobile-web-app-capable" content="existing">');
    assert.isNotNull(r.querySelector('meta[name="mobile-web-app-capable"][content="existing"]'));
    assert.isNull(r.querySelector('meta[name="mobile-web-app-capable"][content="yes"]'));
    assert.lengthOf(r.querySelectorAll('meta[name="mobile-web-app-capable"]'), 1, 'found only one node');
  });

  test('should not add link icon if it was present beforehand', async () => {
    const manifest = {
      'icons': [
        {
          'src': 'NEW-192.png',
          'sizes': '192x192',
        },
      ],
    };
    const r = await testManifest(manifest, '<link rel="icon" href="EXISTING-192.png" sizes="192x192">');
    assert.isNotNull(r.querySelector('link[rel="icon"][href="EXISTING-192.png"][sizes="192x192"]'));
    assert.isNull(r.querySelector('link[rel="icon"][href="NEW-192.png"][sizes="192x192"]'));
  });

  test('iOS splash', async () => {
    const manifest = {
      'short_name': 'Test',
      'icons': [
        {
          'src': window.location.origin + '/demo/logo-192.png',
          'sizes': '192x192',
        },
      ],
      display: 'standalone',
    };

    const override = {
      vendor: 'Apple',
      userAgent: 'Mobile/',
      standalone: false,
    };

    // TODO(samthor): delay is just a bit awkward
    const r = await testManifest(manifest, '', override, 100);

    assert.isNotNull(r.querySelector('meta[name="apple-mobile-web-app-title"]'), 'should have title');
    assert.isNotNull(r.querySelector('meta[name="apple-mobile-web-app-capable"]'), 'should be capable');

    const images = r.querySelectorAll('link[rel="apple-touch-startup-image"]');
    assert.lengthOf(images, 2);

    const [portrait, landscape] = images;
    assert.equal(portrait.media, '(orientation: portrait)');
    assert.equal(landscape.media, '(orientation: landscape)');
    // TODO(samthor): check sizes
  });

  // TODO(samthor): Test Edge and non-iOS environments with overrides.
});
