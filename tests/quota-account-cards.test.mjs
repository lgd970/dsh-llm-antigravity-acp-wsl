// UI tests for QuotaPill, Popover dialog, and SettingsCard in src/client.js / lib/client.js.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const srcClientPath = join(root, 'src', 'client.js')
const libClientPath = join(root, 'lib', 'client.js')

const FIXED_NOW = Date.parse('2026-11-04T12:00:00.000Z')
const isoAfterHours = (hours) => new Date(FIXED_NOW + hours * 3_600_000).toISOString()

function createMiniReact() {
  let active = null

  const flatten = (items, out = []) => {
    for (const item of items) {
      if (Array.isArray(item)) flatten(item, out)
      else if (item !== null && item !== undefined && typeof item !== 'boolean') out.push(item)
    }
    return out
  }

  const depsEqual = (a, b) => {
    if (!a || !b || a.length !== b.length) return false
    for (let i = 0; i < a.length; i += 1) {
      if (!Object.is(a[i], b[i])) return false
    }
    return true
  }

  const React = {
    createElement(type, props, ...children) {
      const flat = flatten(children)
      const nextProps = { ...(props || {}) }
      if (flat.length > 0) nextProps.children = flat
      return { __vnode: true, type, props: nextProps, ref: props ? props.ref : undefined }
    },
    useState(initial) {
      const inst = active
      const idx = inst.hookIndex++
      if (!(idx in inst.hooks)) {
        inst.hooks[idx] = { value: typeof initial === 'function' ? initial() : initial }
      }
      const slot = inst.hooks[idx]
      const setState = (next) => {
        const value = typeof next === 'function' ? next(slot.value) : next
        if (!Object.is(value, slot.value)) {
          slot.value = value
          inst.root.render()
        }
      }
      return [slot.value, setState]
    },
    useRef(initial) {
      const inst = active
      const idx = inst.hookIndex++
      if (!(idx in inst.hooks)) inst.hooks[idx] = { current: initial }
      return inst.hooks[idx]
    },
    useCallback(fn, deps) {
      const inst = active
      const idx = inst.hookIndex++
      const prev = inst.hooks[idx]
      if (!prev || !depsEqual(prev.deps, deps)) inst.hooks[idx] = { fn, deps }
      return inst.hooks[idx].fn
    },
    useEffect(fn, deps) {
      const inst = active
      const idx = inst.hookIndex++
      const prev = inst.hooks[idx]
      if (!prev || !depsEqual(prev.deps, deps)) {
        const slot = { deps, cleanup: prev ? prev.cleanup : undefined }
        inst.hooks[idx] = slot
        inst.root.pendingEffects.push(() => {
          if (typeof slot.cleanup === 'function') slot.cleanup()
          slot.cleanup = fn()
        })
      }
    },
    useSyncExternalStore(subscribe, getSnapshot) {
      React.useEffect(() => subscribe(() => activeRootRender()), [subscribe])
      const inst = active
      const activeRootRender = () => inst.root.render()
      return getSnapshot()
    },
  }

  function mount(Component, initialProps) {
    const root = {
      props: initialProps,
      instances: new Map(),
      pendingEffects: [],
      tree: null,
      render() {
        const seen = new Set()
        const renderVNode = (vnode, path) => {
          if (vnode === null || vnode === undefined || typeof vnode === 'boolean') return null
          if (typeof vnode === 'string' || typeof vnode === 'number') return String(vnode)
          if (!vnode.__vnode) return null

          if (typeof vnode.type === 'function') {
            seen.add(path)
            let inst = root.instances.get(path)
            if (!inst) {
              inst = { hooks: [], hookIndex: 0, root }
              root.instances.set(path, inst)
            }
            const prev = active
            active = inst
            inst.hookIndex = 0
            const rendered = vnode.type(vnode.props)
            active = prev
            return renderVNode(rendered, `${path}>f`)
          }

          const children = (vnode.props.children || [])
            .map((child, i) => renderVNode(child, `${path}/${i}`))
            .filter((child) => child !== null)
          const host = { tag: vnode.type, props: vnode.props, children }
          if (vnode.ref && typeof vnode.ref === 'object') {
            vnode.ref.current = {
              node: host,
              contains: (target) => Boolean(target && target.__insideRoot === vnode.ref),
            }
          }
          return host
        }

        root.tree = renderVNode(React.createElement(Component, root.props), 'root')
        for (const [key, inst] of root.instances.entries()) {
          if (!seen.has(key)) {
            for (const h of inst.hooks) {
              if (h && typeof h.cleanup === 'function') h.cleanup()
            }
            root.instances.delete(key)
          }
        }
        while (root.pendingEffects.length > 0) {
          const batch = root.pendingEffects.splice(0)
          for (const run of batch) run()
        }
        return root.tree
      },
      rerender(nextProps) {
        root.props = nextProps
        return root.render()
      },
      unmount() {
        for (const inst of root.instances.values()) {
          for (const h of inst.hooks) {
            if (h && typeof h.cleanup === 'function') h.cleanup()
          }
        }
        root.instances.clear()
        root.tree = null
      },
    }
    root.render()
    return root
  }

  return { React, mount }
}

function textOf(node) {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string') return node
  return (node.children || []).map(textOf).join('')
}

function findAll(node, predicate, acc = []) {
  if (!node || typeof node === 'string') return acc
  if (predicate(node)) acc.push(node)
  for (const child of node.children || []) findAll(child, predicate, acc)
  return acc
}

function findOne(node, predicate) {
  return findAll(node, predicate)[0] || null
}

const flush = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function loadClientPlugin({ language = 'zh-CN', remoteService, sessions, uiWorkspace } = {}) {
  const { React, mount } = createMiniReact()
  const listeners = new Map()
  const document = {
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(fn)
    },
    removeEventListener(type, fn) {
      if (listeners.has(type)) listeners.get(type).delete(fn)
    },
    dispatch(type, event) {
      for (const fn of [...(listeners.get(type) || [])]) fn(event)
    },
  }

  let loadedSpec = null
  const window = {
    __ModuleLoader__: {
      load(spec) {
        loadedSpec = spec
      },
    },
  }

  class CustomDate extends Date {
    static now() {
      return FIXED_NOW
    }
  }

  const intervals = new Set()
  const sandbox = {
    window,
    document,
    navigator: { language },
    Date: CustomDate,
    console,
    TypeError,
    Error,
    Promise,
    Object,
    Array,
    Number,
    String,
    Math,
    RegExp,
    setTimeout,
    clearTimeout,
    setInterval(fn) {
      const token = { fn }
      intervals.add(token)
      return token
    },
    clearInterval(token) {
      intervals.delete(token)
    },
  }

  const code = `${readFileSync(join(root, 'src', 'model-selection.js'), 'utf8')}\n${readFileSync(srcClientPath, 'utf8')}`
  vm.runInNewContext(code, sandbox, { filename: libClientPath })
  assert.ok(loadedSpec, 'window.__ModuleLoader__.load should receive module spec')
  assert.equal(loadedSpec.id, 'dsh-llm-antigravity-acp')

  const plugin = loadedSpec.factory((pkg) => {
    if (pkg === 'react') return React
    if (pkg === '@deepseek-ai/dsh-client-ui-primitives') {
      return {
        Modal(props) {
          if (props.open !== true) return null
          const footer = props.footer ? (Array.isArray(props.footer) ? props.footer : [props.footer]) : []
          return React.createElement('div', { 'aria-label': props.title, role: 'dialog' }, props.children, ...footer)
        },
        Button(props) {
          return React.createElement('button', {
            type: 'button',
            disabled: props.disabled,
            onClick: props.onClick,
            title: props.title,
          }, props.children)
        },
      }
    }
    throw new Error(`Unexpected require(${pkg})`)
  })

  const registered = new Map()
  let currentModel = { provider: 'antigravity', model: 'gemini-4-argon' }
  const storeSubscribers = new Set()
  const store = {
    getSnapshot: () => ({ current: currentModel }),
    subscribe: (cb) => {
      storeSubscribers.add(cb)
      return () => storeSubscribers.delete(cb)
    },
    setCurrent(next) {
      currentModel = next
      for (const cb of [...storeSubscribers]) cb()
    },
  }

  const defaultService = {
    status: async () => ({
      state: 'ready',
      version: '1.2.3',
      contextWindow: 1_048_576,
      configuredContextWindow: 0,
      defaultEffort: 'high',
      longDecodeContinuations: 3,
      unlock: { status: 'unlocked' },
    }),
    quota: async () => ({ status: 'ok', updatedAt: new Date(FIXED_NOW).toISOString(), groups: [] }),
    warmup: async () => ({ state: 'ready', version: '1.2.3', contextWindow: 1_048_576 }),
    configure: async (patch) => ({ state: 'ready', version: '1.2.3', contextWindow: 1_048_576, ...patch }),
    accounts: async () => [],
  }
  // Overrides merge over the defaults, so a test that only fakes one verb
  // still answers every other call the card makes.
  const service = { ...defaultService, ...(remoteService || {}) }

  const slots = {
    inject(_slotName, registerFn) {
      return registerFn()
    },
    register(meta, Component) {
      registered.set(meta.name, { meta, Component })
      return () => registered.delete(meta.name)
    },
  }

  const ctx = {
    remote: { $mount: () => () => undefined, session: { selectModel: async () => undefined } },
    slots,
    modelDirectories: { directoryFor: () => ({ store }) },
    sessions: sessions || {
      binding: () => undefined,
      list: { getSnapshot: () => ({ byId: {} }) },
      create: async () => 'child-session-default',
      fork: async () => 'child-session-forked',
      retain: () => ({ ready: Promise.resolve({ session: { beginSubmission: () => ({ requestId: 'r1', abandon: () => {} }), prompt: async () => ({ ok: true }) } }), release: () => {} }),
    },
    uiWorkspace: uiWorkspace || { openSession: () => {} },
    effect(fn) {
      fn()
    },
    get(key) {
      if (key === 'remote.antigravityAcp') return service
      return undefined
    },
    inject(_deps, cb) {
      cb(ctx)
    },
  }

  plugin.apply(ctx)
  return { registered, mount, document, store, intervals }
}

const roster = Array.from({length: 5}, (_,i) => ({id:`a${i+1}`,email:`user${i+1}@example.com`,subscriptionTier:'PRO'}))
const payload = (accountId, model='gemini-4-argon', fraction=.61, both=true) => ({status:'ok',accountId,model,subscriptionTier:'ULTRA',argonSharedWithGemini:true,groups:[{name:'Gemini Models',buckets:[{id:'weekly',window:'weekly',remainingFraction:fraction,resetTime:isoAfterHours(20)},...(both?[{id:'five_hour',window:'5h',remainingFraction:.33,resetTime:isoAfterHours(2)}]:[])]}]})
const openPill = async (view) => {findOne(view.tree,n=>n.tag==='button').props.onClick();await flush()}
const dialogOf = view => findOne(view.tree,n=>n.props.role==='dialog')
const tab = (view,id) => findOne(view.tree,n=>n.props['data-agy-card-account']===id)
const refreshCardButton = view => findOne(dialogOf(view),n=>n.tag==='button'&&n.props.title==='刷新当前账号')
function setup(quota) {
 const calls=[]
 const h=loadClientPlugin({remoteService:{status:async()=>({accounts:roster}),quota:async o=>{calls.push(o);return quota?quota(o):payload(o.accountId||'a3',o.model)}}})
 const slot=h.registered.get('conversation.input.right');const view=h.mount(slot.Component,slot.meta.inject('session-test'))
 return {...h,view,calls}
}
test('five tabs default to serving account; both windows render; browsing never changes collapsed pill',async()=>{
 const {view,calls,intervals}=setup(o=>payload(o.accountId||'a3',o.model,o.accountId==='a2'?.22:.61))
 await flush();await openPill(view)
 assert.equal(findAll(dialogOf(view),n=>n.props.role==='tab').length,5)
 assert.equal(tab(view,'a3').props['aria-selected'],true)
 assert.match(textOf(dialogOf(view)),/5 小时额度.*33%/)
 assert.match(textOf(dialogOf(view)),/每周额度.*61%/)
 tab(view,'a2').props.onClick();await flush()
 assert.match(textOf(dialogOf(view)),/user2@example.com/)
 assert.match(textOf(dialogOf(view)),/每周额度.*22%/)
 assert.match(textOf(findOne(view.tree,n=>n.tag==='button')),/61%/)
 assert.equal(calls.at(-1).accountId,'a2')
 assert.equal(intervals.size,1,'only existing serving-account timer remains')
 view.unmount()
})
test('card cache is keyed by account/model; refresh forces only current card',async()=>{
 const {view,calls,store}=setup();await flush();await openPill(view)
 tab(view,'a2').props.onClick();await flush();const before=calls.length
 tab(view,'a3').props.onClick();await flush();assert.equal(calls.length,before)
 refreshCardButton(view).props.onClick();await flush();assert.equal(calls.at(-1).accountId,'a3');assert.equal(calls.at(-1).force,true)
 store.setCurrent({provider:'antigravity',model:'gemini-3.8-flash'});await flush()
 assert(calls.some(o=>o.accountId==='a3'&&o.model==='gemini-3.8-flash'))
 view.unmount()
})
test('missing windows are explicit and never fabricated as 100%',async()=>{
 const {view}=setup(o=>payload(o.accountId||'a3',o.model,.42,false));await flush();await openPill(view)
 const short=findOne(dialogOf(view),n=>n.props['data-bucket-window']==='5h')
 assert.match(textOf(short),/未返回/);assert.doesNotMatch(textOf(short),/100%/)
 assert.equal(findAll(dialogOf(view),n=>n.props['data-bucket-role']==='account-window').length,2)
 view.unmount()
})
test('stale account replies, mismatched attribution and errors cannot paint another card',async()=>{
 let resolveA2
 const {view}=setup(o=>o.accountId==='a2'?new Promise(r=>{resolveA2=r}):o.accountId==='a4'?payload('wrong',o.model,.99):payload(o.accountId||'a3',o.model,.61))
 await flush();await openPill(view);tab(view,'a2').props.onClick();await flush();tab(view,'a1').props.onClick();await flush()
 resolveA2(payload('a2','gemini-4-argon',.99));await flush();assert.doesNotMatch(textOf(dialogOf(view)),/99%/)
 tab(view,'a4').props.onClick();await flush();assert.match(textOf(dialogOf(view)),/响应与当前账号或模型不匹配/);assert.doesNotMatch(textOf(dialogOf(view)),/61%|99%/)
 view.unmount()
})
test('closing panel drops in-flight reads and reopen defaults to scheduler account',async()=>{
 let resolveA2
 const {view,document}=setup(o=>o.accountId==='a2'?new Promise(r=>{resolveA2=r}):payload(o.accountId||'a3',o.model))
 await flush();await openPill(view);tab(view,'a2').props.onClick();await flush();document.dispatch('keydown',{key:'Escape'})
 resolveA2(payload('a2','gemini-4-argon',.99));await flush();assert.equal(dialogOf(view),null)
 await openPill(view);assert.equal(tab(view,'a3').props['aria-selected'],true);assert.doesNotMatch(textOf(dialogOf(view)),/99%/)
 view.unmount()
})