import { describe, expect, it } from 'vitest'
import {
  ExecutionTimeoutError,
} from '../execution-policy'
import {
  PresalesExecutionError,
  classifyExecutionError,
} from '../execution-errors'

describe('classifyExecutionError', () => {
  it('普通错误归类为 failed', () => {
    expect(classifyExecutionError(new Error('数据库失败'))).toBe('failed')
    expect(classifyExecutionError(new PresalesExecutionError('提交失败'))).toBe('failed')
  })

  it('AbortError 归类为 cancelled', () => {
    expect(classifyExecutionError(new DOMException('用户取消', 'AbortError'))).toBe('cancelled')
  })

  it('TimeoutError 归类为 timed_out', () => {
    expect(classifyExecutionError(new ExecutionTimeoutError())).toBe('timed_out')
  })

  it('以 signal 的取消原因为准识别超时', () => {
    const controller = new AbortController()
    controller.abort(new ExecutionTimeoutError('节点超时'))

    expect(classifyExecutionError(new DOMException('中止', 'AbortError'), controller.signal))
      .toBe('timed_out')
  })

  it('signal 已取消且没有 Error 原因时归类为 cancelled', () => {
    const controller = new AbortController()
    controller.abort('用户停止')

    expect(classifyExecutionError(new Error('底层错误'), controller.signal)).toBe('cancelled')
  })
})
