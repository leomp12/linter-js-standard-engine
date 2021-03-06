/* global describe, it, beforeEach */

const path = require('path')
const expect = require('unexpected').clone()
const proxyquire = require('proxyquire').noPreserveCache()
const textEditorFactory = require('../util/textEditorFactory')
const { MissingLinterError, MissingPackageError } = require('../../lib/findOptions')

describe('lib/linting', () => {
  const optInManager = proxyquire('../../lib/optInManager', {})
  optInManager.activate()
  let hasPermission = true
  optInManager.checkPermission = () => Promise.resolve(hasPermission)

  let stub
  const linting = proxyquire('../../lib/linting', {
    './optInManager': optInManager,
    './workerManagement': {
      getWorker () {
        return {
          fix (...args) {
            return stub(...args)
          },
          lint (...args) {
            return stub(...args)
          }
        }
      }
    }
  })

  beforeEach(() => {
    hasPermission = true
    stub = undefined
  })

  describe('lint()', () => {
    it('should convert an eslint report to an atom report', () => {
      stub = () => Promise.resolve([
        {
          filePath: '<text>',
          messages: [
            {
              ruleId: 'eol-last',
              severity: 2,
              message: 'Newline required at end of file but not found.',
              line: 1,
              column: 2,
              nodeType: 'Program',
              source: 'var foo = "bar"',
              fix: { range: [15, 15], text: '\n' }
            },
            {
              ruleId: 'no-unused-vars',
              severity: 1,
              message: '"foo" is defined but never used',
              line: 1,
              column: 5,
              nodeType: 'Identifier',
              source: 'var foo = "bar"'
            },
            {
              ruleId: 'quotes',
              severity: 2,
              message: 'Strings must use singlequote.',
              line: 1,
              column: 11,
              nodeType: 'Literal',
              source: 'var foo = "bar"',
              fix: { range: [10, 15], text: "'bar'" }
            },
            {
              severity: 2,
              message: 'Made up message to test fallback code paths'
            }
          ],
          errorCount: 3,
          warningCount: 0
        }
      ])

      const filePath = path.resolve(__dirname, '..', 'fixtures', 'file.js')
      const textEditor = textEditorFactory({
        source: 'var foo = "bar"',
        path: filePath
      })
      return expect(linting.lint(textEditor), 'to be fulfilled').then(report => expect(report, 'to equal', [
        {
          severity: 'error',
          excerpt: 'Newline required at end of file but not found.',
          location: {
            file: filePath,
            position: [ [ 0, 0 ], [ 0, 1 ] ]
          },
          solutions: [
            {
              position: [ [ 0, 0 ], [ 0, 0 ] ], // Mocked out position calculation...
              replaceWith: '\n'
            }
          ]
        },
        {
          severity: 'warning',
          excerpt: '"foo" is defined but never used',
          location: {
            file: filePath,
            position: [ [ 0, 1 ], [ 0, 4 ] ]
          }
        },
        {
          severity: 'error',
          excerpt: 'Strings must use singlequote.',
          location: {
            file: filePath,
            position: [ [ 0, 1 ], [ 0, 10 ] ]
          },
          solutions: [
            {
              position: [ [ 0, 0 ], [ 0, 0 ] ], // Mocked out position calculation...
              replaceWith: '\'bar\''
            }
          ]
        },
        {
          severity: 'error',
          excerpt: 'Made up message to test fallback code paths',
          location: {
            file: filePath,
            position: [ [ 0, 0 ], [ 0, 0 ] ]
          }
        }
      ]))
    })
  })

  describe('fix()', () => {
    it('should return the output from an eslint report', () => {
      stub = () => Promise.resolve([
        {
          filePath: '<text>',
          messages: [],
          output: 'fixed'
        }
      ])

      const filePath = path.resolve(__dirname, '..', 'fixtures', 'file.js')
      const textEditor = textEditorFactory({
        source: 'var foo = "bar"',
        path: filePath
      })
      return expect(linting.fix(textEditor), 'to be fulfilled')
        .then(output => expect(output, 'to equal', 'fixed'))
    })
  })

  for (const { method, emptiness, returnDescription } of [
    { method: 'fix', emptiness: 'null', returnDescription: 'null' },
    { method: 'lint', emptiness: 'empty', returnDescription: 'an empty array' }
  ]) {
    describe(`${method}()`, () => {
      it(`should return ${returnDescription} if the file is ignored`, () => {
        stub = () => Promise.reject(new Error('Should never be called'))
        const filePath = path.resolve(__dirname, '..', 'fixtures', 'scopedLinter', 'world')
        const textEditor = textEditorFactory({
          source: 'var foo = "bar"',
          path: filePath
        })
        return expect(linting[method](textEditor), 'to be fulfilled')
          .then(output => expect(output, `to be ${emptiness}`))
      })

      it(`should return ${returnDescription} if there is no permission for the linter to run`, () => {
        const filePath = path.resolve(__dirname, '..', 'fixtures', 'file.js')
        const textEditor = textEditorFactory({
          source: 'var foo = "bar"',
          path: filePath
        })
        hasPermission = false
        stub = () => Promise.resolve([
          {
            filePath,
            messages: [
              {
                ruleId: 'eol-last',
                severity: 2,
                message: 'Newline required at end of file but not found.',
                line: 1,
                column: 2,
                nodeType: 'Program',
                source: 'var foo = "bar"',
                fix: { range: [15, 15], text: '\n' }
              }
            ],
            output: 'fixed'
          }
        ])
        return expect(linting[method](textEditor), 'to be fulfilled')
          .then(output => expect(output, `to be ${emptiness}`))
      })

      describe('error handling', () => {
        let currentError
        const stubbedOptions = proxyquire('../../lib/linting', {
          './findOptions' () {
            return Promise.reject(currentError)
          }
        })

        let reportedError
        const reportError = err => { reportedError = err }

        for (const ErrorClass of [MissingLinterError, MissingPackageError]) {
          it(`should suppress "${ErrorClass.name}" errors`, () => {
            currentError = new ErrorClass()
            return expect(stubbedOptions[method](textEditorFactory('')), 'to be fulfilled')
              .then(data => expect(data, `to be ${emptiness}`))
          })
        }

        it('should report errors that are not suppressed', () => {
          currentError = new Error('do not suppress me')
          stub = () => Promise.reject(currentError)
          return expect(linting[method](textEditorFactory(''), reportError), 'to be fulfilled').then(data => {
            expect(data, `to be ${emptiness}`)
            expect(reportedError, 'to be', currentError)
          })
        })
        it('should add errors that are not suppressed with a default description', () => {
          currentError = new Error('')
          stub = () => Promise.reject(currentError)
          return expect(linting[method](textEditorFactory(''), reportError), 'to be fulfilled').then(data => {
            expect(data, `to be ${emptiness}`)
            expect(reportedError, 'to be', currentError)
          })
        })
      })

      it('should add an error upon receiving an invalid report from the linters lintText() method', () => {
        stub = () => Promise.resolve([])
        let reportedError
        const reportError = err => { reportedError = err }
        return expect(linting[method](textEditorFactory(''), reportError), 'to be fulfilled').then(data => {
          expect(data, `to be ${emptiness}`)
          expect(reportedError, 'to have message', 'Invalid lint report')
        })
      })
    })
  }
})
