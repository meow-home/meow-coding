/*
 * Meow desktop pet — a mascot derived from the app logo (meow-coding-logo.svg).
 * Classic script (no modules) so the preview page also works from file://.
 * Exposes window.MeowPet.create(host, options).
 *
 * The pet reuses the logo geometry verbatim: the rounded-square cat head with the two
 * ear notches, the blue prompt chevron and the orange cursor. Nothing is redrawn by hand,
 * so the mascot stays on-brand at every size.
 */
;(function () {
  'use strict'

  // Exact path from meow-coding-logo.svg (64 x 64 grid).
  var HEAD =
    'M8 28 Q8 20 13 20 C14.1 15 16.1 11.4 17.9 10.7 C19.7 11.4 21.9 15 24.5 20 H39.5 C42.1 15 44.3 11.4 46.1 10.7 C47.9 11.4 49.9 15 50.5 20 Q56 20 56 28 V48 Q56 56 48 56 H16 Q8 56 8 48 Z'

  var BLUE = '#3b8bf5'
  var ORANGE = '#f7941d'

  // Face parts live in the 64-grid of the logo, so they line up with the shell exactly.
  function prompt(sw) {
    return (
      '<path class="mp-eye" d="M18.5 31 L26 38 L18.5 45" fill="none" stroke="' +
      BLUE +
      '" stroke-width="' +
      sw +
      '" stroke-linecap="round" stroke-linejoin="round"/>'
    )
  }
  function cursor(sw) {
    return (
      '<path class="mp-cursor" d="M31 45 H42" fill="none" stroke="' +
      ORANGE +
      '" stroke-width="' +
      sw +
      '" stroke-linecap="round"/>'
    )
  }

  var FACES = {
    // A — the logo as-is: the prompt chevron is the eye, the cursor is the mouth.
    a: {
      open: prompt(5) + cursor(5),
      happy:
        '<path class="mp-eye" d="M17.5 42 L24 33.5 L30.5 42" fill="none" stroke="' +
        BLUE +
        '" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>' +
        '<path class="mp-cursor" d="M34.5 43.5 H42" fill="none" stroke="' +
        ORANGE +
        '" stroke-width="5" stroke-linecap="round"/>',
      sleep:
        '<path d="M17.5 38 H26.5" fill="none" stroke="' +
        BLUE +
        '" stroke-width="4.6" stroke-linecap="round"/>',
      error:
        '<path d="M21 30 V39.5" fill="none" stroke="' +
        ORANGE +
        '" stroke-width="4.6" stroke-linecap="round"/>' +
        '<circle cx="21" cy="45.5" r="2.4" fill="' +
        ORANGE +
        '"/>'
    },
    // B — two round eyes: a friendlier read, still the logo's ears and palette.
    b: {
      open:
        '<g class="mp-eye"><ellipse cx="25.5" cy="35.5" rx="4.7" ry="5.3" fill="' +
        BLUE +
        '"/><circle cx="23.7" cy="33.3" r="1.4" fill="#fff" opacity=".82"/></g>' +
        '<g class="mp-eye"><ellipse cx="38.5" cy="35.5" rx="4.7" ry="5.3" fill="' +
        BLUE +
        '"/><circle cx="36.7" cy="33.3" r="1.4" fill="#fff" opacity=".82"/></g>' +
        '<path d="M28.5 45 Q32 48.4 35.5 45" fill="none" stroke="' +
        ORANGE +
        '" stroke-width="3.2" stroke-linecap="round"/>',
      happy:
        '<path class="mp-eye" d="M20.5 38 Q25.5 31.6 30.5 38" fill="none" stroke="' +
        BLUE +
        '" stroke-width="3.6" stroke-linecap="round"/>' +
        '<path class="mp-eye" d="M33.5 38 Q38.5 31.6 43.5 38" fill="none" stroke="' +
        BLUE +
        '" stroke-width="3.6" stroke-linecap="round"/>' +
        '<path d="M28 44.4 Q32 49.2 36 44.4" fill="none" stroke="' +
        ORANGE +
        '" stroke-width="3.6" stroke-linecap="round"/>',
      sleep:
        '<path class="mp-eye" d="M21 36.6 Q25.5 40 30 36.6" fill="none" stroke="' +
        BLUE +
        '" stroke-width="3.4" stroke-linecap="round"/>' +
        '<path class="mp-eye" d="M34 36.6 Q38.5 40 43 36.6" fill="none" stroke="' +
        BLUE +
        '" stroke-width="3.4" stroke-linecap="round"/>' +
        '<path d="M29 45.4 H35" fill="none" stroke="' +
        ORANGE +
        '" stroke-width="3" stroke-linecap="round"/>',
      error:
        '<path class="mp-eye" d="M21.4 32.4 L28.6 39.6 M28.6 32.4 L21.4 39.6" fill="none" stroke="' +
        BLUE +
        '" stroke-width="3.4" stroke-linecap="round"/>' +
        '<path class="mp-eye" d="M35.4 32.4 L42.6 39.6 M42.6 32.4 L35.4 39.6" fill="none" stroke="' +
        BLUE +
        '" stroke-width="3.4" stroke-linecap="round"/>' +
        '<path d="M29 45.4 H35" fill="none" stroke="' +
        ORANGE +
        '" stroke-width="3" stroke-linecap="round"/>'
    },
    // C — the head is a tiny terminal: a mini window screen carries the prompt.
    c: {
      open:
        '<path class="mp-eye" d="M17.4 36.6 L22.8 41.2 L17.4 45.8" fill="none" stroke="' +
        BLUE +
        '" stroke-width="3.8" stroke-linecap="round" stroke-linejoin="round"/>' +
        '<path class="mp-cursor" d="M26.2 44.9 H36.6" fill="none" stroke="' +
        ORANGE +
        '" stroke-width="3.8" stroke-linecap="round"/>',
      happy:
        '<path class="mp-eye" d="M16.8 45 L21.4 37.6 L26 45" fill="none" stroke="' +
        BLUE +
        '" stroke-width="3.8" stroke-linecap="round" stroke-linejoin="round"/>' +
        '<path class="mp-cursor" d="M28.6 44.4 H36.8" fill="none" stroke="' +
        ORANGE +
        '" stroke-width="3.8" stroke-linecap="round"/>',
      sleep:
        '<path d="M17 41.6 H26" fill="none" stroke="' +
        BLUE +
        '" stroke-width="3.4" stroke-linecap="round"/>',
      error:
        '<path d="M21.2 35.4 V43.4" fill="none" stroke="' +
        ORANGE +
        '" stroke-width="3.8" stroke-linecap="round"/>' +
        '<circle cx="21.2" cy="47" r="1.9" fill="' +
        ORANGE +
        '"/>'
    }
  }

  var SCREEN =
    '<rect x="13.5" y="27" width="37" height="21" rx="6" fill="#0e1014"/>' +
    '<rect x="13.5" y="27" width="37" height="21" rx="6" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="1"/>' +
    '<circle cx="17.9" cy="31.4" r="1.35" fill="#ff6159" opacity=".9"/>' +
    '<circle cx="21.7" cy="31.4" r="1.35" fill="#ffbd2e" opacity=".9"/>' +
    '<circle cx="25.5" cy="31.4" r="1.35" fill="#28c840" opacity=".9"/>'

  var MOODS = [
    'idle',
    'look',
    'walk',
    'run',
    'type',
    'think',
    'sleep',
    'happy',
    'error',
    'drag',
    'notify'
  ]

  // Which face a mood shows. Everything else is motion + FX.
  var FACE_FOR = {
    idle: 'open',
    look: 'open',
    walk: 'open',
    run: 'open',
    type: 'open',
    think: 'open',
    sleep: 'sleep',
    happy: 'happy',
    error: 'error',
    drag: 'open',
    notify: 'open'
  }

  var TYPE_LINES = ['npm test', 'npm run dev', 'git status', 'ship it']

  // A small tail curling up on the right: its base sits under the body's lower-right corner (one end
  // attached, hidden), the rest of the curve stays clear of the silhouette and the tip is free.
  var TAIL = '<path class="mp-tail" d="M76 79 C82 80 89.5 76 90 69 C90.5 62.5 89 59.5 87 61.5" fill="none" stroke-linecap="round"/>'

  var uid = 0

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
    })
  }

  function facesMarkup(variant, current) {
    var set = FACES[variant] || FACES.a
    var out = ''
    for (var key in set) {
      if (!Object.prototype.hasOwnProperty.call(set, key)) continue
      out +=
        '<g class="mp-face' +
        (key === current ? ' is-on' : '') +
        '" data-face="' +
        key +
        '">' +
        set[key] +
        '</g>'
    }
    return out
  }

  function svgMarkup(variant, currentFace, id) {
    return (
      '<svg class="mp__svg" viewBox="0 0 96 96" aria-hidden="true" focusable="false">' +
      '<defs>' +
      '<linearGradient id="mpg-' +
      id +
      '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#2a3038"/><stop offset="0.55" stop-color="#1d2127"/><stop offset="1" stop-color="#15181c"/>' +
      '</linearGradient>' +
      '</defs>' +
      '<g class="mp-feet">' +
      '<rect class="mp-foot mp-foot--l" x="30" y="75" width="13" height="13" rx="6.5"/>' +
      '<rect class="mp-foot mp-foot--r" x="53" y="75" width="13" height="13" rx="6.5"/>' +
      '</g>' +
      TAIL +
      '<g transform="translate(3.2 4) scale(1.4)">' +
      '<g class="mp__head">' +
      '<path d="' +
      HEAD +
      '" fill="url(#mpg-' +
      id +
      ')"/>' +
      '<path d="' +
      HEAD +
      '" fill="none" stroke="rgba(255,255,255,.075)" stroke-width="1.1"/>' +
      '<path class="mp-ear mp-ear--l" d="M15.9 19.7 L17.7 13.6 L20.1 19.7 Z" fill="' +
      BLUE +
      '" opacity=".3"/>' +
      '<path class="mp-ear mp-ear--r" d="M48.1 19.7 L46.3 13.6 L43.9 19.7 Z" fill="' +
      ORANGE +
      '" opacity=".3"/>' +
      (variant === 'c' ? SCREEN : '') +
      facesMarkup(variant, currentFace) +
      '</g></g>' +
      '</svg>'
    )
  }

  var FX =
    '<div class="mp__glow"></div>' +
    '<div class="mp__think"><i></i><i></i><i></i></div>' +
    '<div class="mp__zzz"><i>z</i><i>z</i><i>z</i></div>' +
    '<div class="mp__spark"><i></i><i></i><i></i><i></i><i></i></div>'

  function create(host, options) {
    var opts = Object.assign(
      {
        variant: 'a',
        size: 128,
        mood: 'idle',
        autoBlink: true,
        label: 'Meow pet'
      },
      options || {}
    )

    var id = 'p' + ++uid
    var el = document.createElement('div')
    el.className = 'mp'
    el.dataset.variant = opts.variant
    el.dataset.mood = opts.mood
    el.style.setProperty('--s', opts.size + 'px')
    el.setAttribute('role', 'img')
    el.setAttribute('aria-label', opts.label)

    var state = {
      variant: opts.variant,
      mood: opts.mood,
      size: opts.size,
      autoBlink: opts.autoBlink,
      baseMood: 'idle'
    }

    var blinkTimer = null
    var revertTimer = null
    var typeTimer = null

    el.innerHTML =
      '<div class="mp__shadow" aria-hidden="true"></div>' +
      '<div class="mp__body">' +
      svgMarkup(state.variant, FACE_FOR[state.mood] || 'open', id) +
      '</div>' +
      '<div class="mp__fx" aria-hidden="true">' +
      FX +
      '</div>' +
      '<div class="mp__bubble" aria-hidden="true"></div>'

    var bubble = el.querySelector('.mp__bubble')

    function paintFace() {
      var want = FACE_FOR[state.mood] || 'open'
      var faces = el.querySelectorAll('.mp-face')
      for (var i = 0; i < faces.length; i++) {
        faces[i].classList.toggle('is-on', faces[i].dataset.face === want)
      }
    }

    function scheduleBlink() {
      clearTimeout(blinkTimer)
      if (!state.autoBlink) return
      blinkTimer = setTimeout(
        function () {
          if (state.mood !== 'sleep' && state.mood !== 'drag') {
            el.dataset.blink = '1'
            setTimeout(function () {
              delete el.dataset.blink
              scheduleBlink()
            }, 130)
          } else {
            scheduleBlink()
          }
        },
        2200 + Math.random() * 3800
      )
    }

    function startTyping() {
      stopTyping()
      bubble.classList.add('is-on')
      var line = 0
      var n = 0
      function tick() {
        var text = TYPE_LINES[line % TYPE_LINES.length]
        n++
        bubble.innerHTML =
          '<span class="mp-bubble__p">&gt;</span>' +
          '<span class="mp-bubble__t">' +
          esc(text.slice(0, n)) +
          '</span>' +
          '<span class="mp-bubble__c"></span>'
        if (n >= text.length) {
          n = 0
          line++
          typeTimer = setTimeout(tick, 1500)
        } else {
          typeTimer = setTimeout(tick, 55 + Math.random() * 70)
        }
      }
      tick()
    }

    function stopTyping() {
      clearTimeout(typeTimer)
      typeTimer = null
      bubble.classList.remove('is-on')
      bubble.innerHTML = ''
    }

    function setMood(mood) {
      if (MOODS.indexOf(mood) === -1) return
      state.mood = mood
      el.dataset.mood = mood
      paintFace()
      if (mood === 'type') startTyping()
      else if (typeTimer) stopTyping()
    }

    /** Play a mood for a while, then fall back to the previous one. */
    function play(mood, ms) {
      var back = state.baseMood
      if (MOODS.indexOf(state.mood) !== -1 && ['happy', 'error', 'notify'].indexOf(state.mood) === -1) {
        back = state.mood
      }
      clearTimeout(revertTimer)
      setMood(mood)
      revertTimer = setTimeout(function () {
        setMood(back === mood ? 'idle' : back)
      }, ms || 1600)
    }

    function setVariant(variant) {
      if (!FACES[variant]) return
      state.variant = variant
      el.dataset.variant = variant
      var body = el.querySelector('.mp__body')
      body.innerHTML = svgMarkup(variant, FACE_FOR[state.mood] || 'open', id)
      paintFace()
    }

    function setSize(px) {
      state.size = px
      el.style.setProperty('--s', px + 'px')
    }

    function setAutoBlink(on) {
      state.autoBlink = !!on
      if (on) scheduleBlink()
      else clearTimeout(blinkTimer)
    }

    function spawnHearts(count) {
      var fx = el.querySelector('.mp__fx')
      for (var i = 0; i < (count || 4); i++) {
        var h = document.createElement('i')
        h.className = 'mp-heart'
        h.textContent = '\u2665'
        h.style.left = 50 + (Math.random() * 34 - 17) + '%'
        h.style.setProperty('--dx', (Math.random() * 26 - 13).toFixed(1) + 'px')
        h.style.animationDelay = i * 70 + 'ms'
        fx.appendChild(h)
        ;(function (node) {
          node.addEventListener('animationend', function () {
            node.remove()
          })
        })(h)
      }
    }

    function destroy() {
      clearTimeout(blinkTimer)
      clearTimeout(revertTimer)
      clearTimeout(typeTimer)
      el.remove()
    }

    host.appendChild(el)
    paintFace()
    scheduleBlink()

    return {
      el: el,
      setMood: setMood,
      play: play,
      setVariant: setVariant,
      setSize: setSize,
      setAutoBlink: setAutoBlink,
      spawnHearts: spawnHearts,
      destroy: destroy,
      get mood() {
        return state.mood
      }
    }
  }

  window.MeowPet = { create: create, MOODS: MOODS, VARIANTS: ['a', 'b', 'c'] }
})()
