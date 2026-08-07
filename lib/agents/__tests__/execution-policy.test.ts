import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ExecutionTimeoutError,
  createManagedAbortSignal,
  throwIfAborted,
  withAbortSignal,
} from '../execution-policy'

const flushMicrotasks = async () => {
  await Promise.resolve()
}

describe('createManagedAbortSignal', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('传播最先发生的外部取消及原因', () => {
    const first = new AbortController()
    const second = new AbortController()
    const managed = createManagedAbortSignal([first.signal, second.signal])
    const reason = new DOMException('用户取消', 'AbortError')

    first.abort(reason)
    second.abort(new ExecutionTimeoutError())

    expect(managed.signal.aborted).toBe(true)
    expect(managed.signal.reason).toBe(reason)
    managed.dispose()
  })

  it('同步传播创建前已取消的信号', () => {
    const source = new AbortController()
    source.abort(new DOMException('已取消', 'AbortError'))

    const managed = createManagedAbortSignal([source.signal], 1_000)

    expect(managed.signal.aborted).toBe(true)
    expect(managed.signal.reason).toBe(source.signal.reason)
    managed.dispose()
  })

  it('在 deadline 到期时产生 TimeoutError', () => {
    vi.useFakeTimers()
    const managed = createManagedAbortSignal([], 250)

    vi.advanceTimersByTime(249)
    expect(managed.signal.aborted).toBe(false)

    vi.advanceTimersByTime(1)
    expect(managed.signal.aborted).toBe(true)
    expect(managed.signal.reason).toBeInstanceOf(ExecutionTimeoutError)
    expect(managed.signal.reason.name).toBe('TimeoutError')
    managed.dispose()
  })

  it.each([undefined, 0, -1])('timeoutMs=%s 时不建立 deadline', (timeoutMs) => {
    vi.useFakeTimers()
    const managed = createManagedAbortSignal([], timeoutMs)

    vi.runAllTimers()

    expect(managed.signal.aborted).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    managed.dispose()
  })

  it('dispose 后清除 timer 并停止传播', () => {
    vi.useFakeTimers()
    const source = new AbortController()
    const managed = createManagedAbortSignal([source.signal], 100)

    managed.dispose()
    managed.dispose()
    source.abort(new DOMException('过晚取消', 'AbortError'))
    vi.runAllTimers()

    expect(managed.signal.aborted).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('withAbortSignal', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('正常完成后清理 deadline', async () => {
    vi.useFakeTimers()

    await expect(withAbortSignal([], 100, async () => 'ok')).resolves.toBe('ok')

    expect(vi.getTimerCount()).toBe(0)
  })

  it('callback 失败后仍清理 deadline', async () => {
    vi.useFakeTimers()
    const failure = new Error('失败')

    await expect(withAbortSignal([], 100, async () => {
      throw failure
    })).rejects.toBe(failure)

    expect(vi.getTimerCount()).toBe(0)
  })

  it('外部取消会中止 callback 并清理', async () => {
    const source = new AbortController()
    const running = withAbortSignal([source.signal], 1_000, async (signal) => {
      await new Promise<void>((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
      return 'unreachable'
    })

    await flushMicrotasks()
    const reason = new DOMException('用户取消', 'AbortError')
    source.abort(reason)

    await expect(running).rejects.toBe(reason)
  })
})

describe('throwIfAborted', () => {
  it('保留 Error 类型的取消原因', () => {
    const controller = new AbortController()
    const reason = new Error('停止')
    controller.abort(reason)

    expect(() => throwIfAborted(controller.signal)).toThrow(reason)
  })

  it('非 Error 原因转换为 AbortError', () => {
    const controller = new AbortController()
    controller.abort('停止')

    expect(() => throwIfAborted(controller.signal)).toThrowError(
      expect.objectContaining({ name: 'AbortError' })
    )
  })
})
