// 行为验证的启动器：tsc 只编译不处理 @/ 别名，这里把 @/ 指到编译产物里的 src。
// 用法：npm run verify:rules
const fs = require('fs')
const Module = require('module')
const path = require('path')

const buildDir = path.join(__dirname, '..', '.verify-build')
// 前端包是 "type": "module"，编译产物是 CommonJS，给产物目录补一个包声明
fs.writeFileSync(path.join(buildDir, 'package.json'), JSON.stringify({ type: 'commonjs' }))

const original = Module._resolveFilename
Module._resolveFilename = function (request, ...args) {
  if (request.startsWith('@/')) {
    request = path.join(buildDir, 'src', request.slice(2))
  }
  return original.call(this, request, ...args)
}

require(path.join(buildDir, 'scripts', 'verify-status-rules.js'))
