const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const babel = require('@babel/standalone')

// Compile the complete entry point, including render(), without a native runtime.
// A source path can be supplied to run the same checks against a packed package.
const filename = path.resolve(process.argv[2] || path.join(__dirname, '..', 'index.js'))
const code = babel.transform(fs.readFileSync(filename, 'utf8'), {
  filename,
  presets: [['env', { targets: { node: '8' } }], 'react'],
  plugins: ['transform-class-properties']
}).code

function createPicker (platform, props) {
  const pending = []
  const opened = []
  const changed = []
  const errors = []
  let result = { action: 'dateSetAction', year: 2024, month: 0, day: 9 }
  const react = {
    Component: class Component {
      constructor (props) { this.props = props }
      setState (update, callback) { pending.push({ update, callback }) }
    },
    createElement: (type, props, ...children) => ({ type, props, children })
  }
  const native = {
    DatePickerAndroid: {
      dismissedAction: 'dismissedAction',
      open: options => {
        opened.push(options)
        return result instanceof Error ? Promise.reject(result) : Promise.resolve(result)
      }
    },
    Platform: { OS: platform },
    StyleSheet: { create: styles => styles },
    ViewPropTypes: { style: () => {} }
  }
  ;['DatePickerIOS', 'Text', 'TouchableOpacity', 'Modal', 'View', 'Button'].forEach(name => {
    native[name] = name
  })
  const modules = {
    react,
    'react-native': native,
    'prop-types': { func: () => {}, string: () => {}, instanceOf: () => () => {} }
  }
  const exports = {}
  vm.runInNewContext(code, {
    exports,
    Date,
    require: name => {
      assert(Object.prototype.hasOwnProperty.call(modules, name), `Unexpected import: ${name}`)
      return modules[name]
    }
  }, { filename })
  const Picker = exports.default
  const picker = new Picker(Object.assign({}, Picker.defaultProps, {
    onDateChanged: value => changed.push(value),
    onError: error => errors.push(error)
  }, props))
  return {
    picker,
    Picker,
    pending,
    opened,
    changed,
    errors,
    respond: value => { result = value },
    flush: () => {
      while (pending.length) {
        const { update, callback } = pending.shift()
        const next = typeof update === 'function' ? update(picker.state, picker.props) : update
        picker.state = Object.assign({}, picker.state, next)
        if (callback) callback()
      }
    }
  }
}

function assertDate (value, year, month, day) {
  assert(value.date instanceof Date)
  assert.strictEqual(value.date.getTime(), new Date(year, month, day).getTime())
  assert.strictEqual(value.year, year)
  assert.strictEqual(value.month, String(month + 1).padStart(2, '0'))
  assert.strictEqual(value.day, String(day).padStart(2, '0'))
  assert.deepStrictEqual(Object.keys(value).sort(), ['date', 'day', 'month', 'year'])
}

function assertEmptyDate (value) {
  assert.strictEqual(value.date, undefined)
  assert.strictEqual(value.year, '')
  assert.strictEqual(value.month, '')
  assert.strictEqual(value.day, '')
}

const tests = []
function test (name, run) { tests.push({ name, run }) }

test('Android selection reports the new date before deferred state commits', async () => {
  const fixture = createPicker('android')
  await fixture.picker.handlePressed()
  assert.strictEqual(fixture.picker.state.date, undefined)
  assert.strictEqual(fixture.pending.length, 1)
  assert.strictEqual(fixture.changed.length, 1)
  assertDate(fixture.changed[0], 2024, 0, 9)
  fixture.flush()
  assert.strictEqual(fixture.picker.state.date, fixture.changed[0].date)
  assert.strictEqual(fixture.picker.state.startDate, fixture.changed[0].date)
  assert.strictEqual(fixture.changed.length, 1)
  assert.strictEqual(fixture.errors.length, 0)
})

test('Android repeated selections do not report the preceding date', async () => {
  const fixture = createPicker('android')
  await fixture.picker.handlePressed()
  fixture.flush()
  const previous = fixture.picker.state.date
  fixture.respond({ action: 'dateSetAction', year: 2025, month: 11, day: 31 })
  await fixture.picker.handlePressed()
  assert.strictEqual(fixture.picker.state.date, previous)
  assert.strictEqual(fixture.changed.length, 2)
  assertDate(fixture.changed[1], 2025, 11, 31)
  assert.strictEqual(fixture.opened[1].date, previous)
  fixture.flush()
  assert.strictEqual(fixture.picker.state.date, fixture.changed[1].date)
})

test('Android selections remain distinct even before either state update commits', async () => {
  const fixture = createPicker('android')
  await fixture.picker.handlePressed()
  fixture.respond({ action: 'dateSetAction', year: 2024, month: 9, day: 12 })
  await fixture.picker.handlePressed()
  assert.strictEqual(fixture.pending.length, 2)
  assert.strictEqual(fixture.changed.length, 2)
  assertDate(fixture.changed[0], 2024, 0, 9)
  assertDate(fixture.changed[1], 2024, 9, 12)
  fixture.flush()
  assert.strictEqual(fixture.picker.state.date, fixture.changed[1].date)
})

test('Android passes startDate and limits unchanged to the picker', async () => {
  const props = { startDate: new Date(2020, 2, 4), minDate: new Date(2010, 0, 1), maxDate: new Date(2030, 0, 1) }
  const fixture = createPicker('android', props)
  fixture.respond({ action: 'dismissedAction' })
  await fixture.picker.handlePressed()
  ;['date', 'minDate', 'maxDate'].forEach(key => {
    assert.strictEqual(fixture.opened[0][key], props[key === 'date' ? 'startDate' : key])
  })
  assert.strictEqual(fixture.pending.length, 0)
  assert.strictEqual(fixture.changed.length, 0)
  assert.strictEqual(fixture.errors.length, 0)
})

test('Android dismissal after a selection leaves state and callbacks unchanged', async () => {
  const fixture = createPicker('android')
  await fixture.picker.handlePressed()
  fixture.flush()
  const previous = fixture.picker.state
  fixture.respond({ action: 'dismissedAction' })
  await fixture.picker.handlePressed()
  assert.strictEqual(fixture.picker.state, previous)
  assert.strictEqual(fixture.pending.length, 0)
  assert.strictEqual(fixture.changed.length, 1)
  assert.strictEqual(fixture.errors.length, 0)
})

test('Android picker rejection reaches onError without a state update', async () => {
  const fixture = createPicker('android')
  const error = new Error('Picker failed')
  fixture.respond(error)
  await fixture.picker.handlePressed()
  assert.deepStrictEqual(fixture.errors, [error])
  assert.strictEqual(fixture.pending.length, 0)
  assert.strictEqual(fixture.changed.length, 0)
})

test('Android throwing consumer callback still reaches onError before state commits', async () => {
  const error = new Error('Consumer failed')
  let calls = 0
  const fixture = createPicker('android', { onDateChanged: () => { calls++; throw error } })
  await fixture.picker.handlePressed()
  assert.strictEqual(calls, 1)
  assert.strictEqual(fixture.picker.state.date, undefined)
  assert.strictEqual(fixture.pending.length, 1)
  assert.deepStrictEqual(fixture.errors, [error])
  fixture.flush()
  assert.strictEqual(calls, 1)
})

test('Android an exception from onError still rejects handlePressed', async () => {
  const error = new Error('Error handler failed')
  const fixture = createPicker('android', { onError: () => { throw error } })
  fixture.respond(new Error('Picker failed'))
  let caught
  try { await fixture.picker.handlePressed() } catch (reason) { caught = reason }
  assert.strictEqual(caught, error)
})

test('Default callbacks remain safe for selection and picker rejection', async () => {
  const fixture = createPicker('android')
  fixture.picker.props.onDateChanged = fixture.Picker.defaultProps.onDateChanged
  fixture.picker.props.onError = fixture.Picker.defaultProps.onError
  await fixture.picker.handlePressed()
  fixture.flush()
  assertDate(fixture.picker.getDateObj(), 2024, 0, 9)
  fixture.respond(new Error('Picker failed'))
  await fixture.picker.handlePressed()
})

test('No-argument formatter and renderDate continue reading committed state', async () => {
  const rendered = []
  const fixture = createPicker('android', { renderDate: value => rendered.push(value) })
  assertEmptyDate(fixture.picker.getDateObj())
  assert.strictEqual(fixture.Picker.defaultProps.renderDate(fixture.picker.getDateObj()), null)
  await fixture.picker.handlePressed()
  fixture.picker.render()
  assertEmptyDate(rendered[0])
  fixture.flush()
  fixture.picker.render()
  assertDate(rendered[1], 2024, 0, 9)
  const element = fixture.Picker.defaultProps.renderDate(fixture.picker.getDateObj())
  assert.strictEqual(element.type, 'Text')
  assert.strictEqual(element.children[0], '2024-01-09')
})

test('iOS modal opening and closing retain deferred callback timing', async () => {
  const fixture = createPicker('ios')
  await fixture.picker.handlePressed()
  assert.strictEqual(fixture.picker.state.showIOSModal, false)
  assert.strictEqual(fixture.opened.length, 0)
  fixture.flush()
  assert.strictEqual(fixture.picker.state.showIOSModal, true)
  const selected = new Date(2023, 1, 28)
  fixture.picker.handleDateChange(selected)
  fixture.picker.handleModalClose()
  assert.strictEqual(fixture.changed.length, 0)
  fixture.flush()
  assert.strictEqual(fixture.picker.state.showIOSModal, false)
  assert.strictEqual(fixture.picker.state.startDate, selected)
  assert.strictEqual(fixture.changed.length, 1)
  assertDate(fixture.changed[0], 2023, 1, 28)
})

test('iOS closing without a date keeps the existing empty payload', () => {
  const fixture = createPicker('ios')
  fixture.picker.handleModalClose()
  assert.strictEqual(fixture.changed.length, 0)
  fixture.flush()
  assert.strictEqual(fixture.changed.length, 1)
  assertEmptyDate(fixture.changed[0])
})

test('iOS consumer exceptions still escape the close callback rather than onError', () => {
  const error = new Error('iOS consumer failed')
  const fixture = createPicker('ios', { onDateChanged: () => { throw error } })
  fixture.picker.handleModalClose()
  assert.throws(fixture.flush, reason => reason === error)
  assert.strictEqual(fixture.errors.length, 0)
})

function run () {
  let failures = 0
  return tests.reduce((previous, entry) => previous.then(() => entry.run()).then(
    () => {
      console.log(`ok - ${entry.name}`)
    },
    error => {
      failures++
      console.error(`not ok - ${entry.name}\n${error.stack}`)
    }
  ), Promise.resolve()).then(() => {
    console.log(`${tests.length - failures}/${tests.length} tests passed`)
    process.exitCode = failures ? 1 : 0
  })
}

run().catch(error => { console.error(error); process.exitCode = 1 })
