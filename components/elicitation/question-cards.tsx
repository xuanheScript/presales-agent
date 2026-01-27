'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Check, MessageSquare } from 'lucide-react'
import type { ElicitationQuestion, ElicitationAnswer } from '@/types'

interface QuestionCardsProps {
  questions: ElicitationQuestion[]
  onSubmit: (answers: ElicitationAnswer[]) => void
  isSubmitting?: boolean
  className?: string
}

interface QuestionState {
  selectedOptions: Set<string>
  customInput: string
  showCustomInput: boolean
}

export function QuestionCards({
  questions,
  onSubmit,
  isSubmitting,
  className,
}: QuestionCardsProps) {
  // 每个问题的状态
  const [questionStates, setQuestionStates] = useState<Record<string, QuestionState>>(() => {
    const initial: Record<string, QuestionState> = {}
    questions.forEach(q => {
      initial[q.id] = {
        selectedOptions: new Set(),
        customInput: '',
        showCustomInput: false,
      }
    })
    return initial
  })

  // 选择选项
  const handleSelectOption = (questionId: string, optionId: string, allowMultiple?: boolean) => {
    setQuestionStates(prev => {
      const current = prev[questionId]
      const newSelected = new Set(current.selectedOptions)

      if (allowMultiple) {
        // 多选模式：切换选中状态
        if (newSelected.has(optionId)) {
          newSelected.delete(optionId)
        } else {
          newSelected.add(optionId)
        }
      } else {
        // 单选模式：点击已选中的选项则取消选中，否则切换选中
        if (newSelected.has(optionId)) {
          newSelected.delete(optionId)
        } else {
          newSelected.clear()
          newSelected.add(optionId)
        }
      }

      return {
        ...prev,
        [questionId]: {
          ...current,
          selectedOptions: newSelected,
        },
      }
    })
  }

  // 切换自定义输入显示
  const handleToggleCustomInput = (questionId: string) => {
    setQuestionStates(prev => ({
      ...prev,
      [questionId]: {
        ...prev[questionId],
        showCustomInput: !prev[questionId].showCustomInput,
      },
    }))
  }

  // 更新自定义输入
  const handleCustomInputChange = (questionId: string, value: string) => {
    setQuestionStates(prev => ({
      ...prev,
      [questionId]: {
        ...prev[questionId],
        customInput: value,
      },
    }))
  }

  // 检查是否所有问题都已回答
  const isAllAnswered = questions.every(q => {
    const state = questionStates[q.id]
    return state.selectedOptions.size > 0 || state.customInput.trim().length > 0
  })

  // 提交回答
  const handleSubmit = () => {
    const answers: ElicitationAnswer[] = questions.map(q => {
      const state = questionStates[q.id]
      // 获取选中选项的 label
      const selectedLabels = Array.from(state.selectedOptions).map(optionId => {
        const option = q.options.find(o => o.id === optionId)
        return option?.label || optionId
      })

      return {
        questionId: q.id,
        selectedOptions: selectedLabels,
        customInput: state.customInput.trim() || undefined,
      }
    })

    onSubmit(answers)
  }

  return (
    <div className={cn('space-y-4', className)}>
      {questions.map((question, index) => {
        const state = questionStates[question.id]

        return (
          <Card key={question.id} className="overflow-hidden">
            <CardHeader className="pb-3 bg-muted/30">
              <CardTitle className="text-sm font-medium flex items-start gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs">
                  {index + 1}
                </span>
                <span>{question.question}</span>
              </CardTitle>
              {question.description && (
                <p className="text-xs text-muted-foreground ml-8">
                  {question.description}
                </p>
              )}
            </CardHeader>
            <CardContent className="pt-4 space-y-3">
              {/* 选项列表 */}
              <div className="grid gap-2">
                {question.options.map(option => {
                  const isSelected = state.selectedOptions.has(option.id)

                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => handleSelectOption(question.id, option.id, question.allowMultiple)}
                      className={cn(
                        'flex items-start gap-3 rounded-lg border p-3 text-left transition-all',
                        'hover:border-primary/50 hover:bg-primary/5',
                        isSelected
                          ? 'border-primary bg-primary/10 ring-1 ring-primary'
                          : 'border-border'
                      )}
                    >
                      <div
                        className={cn(
                          'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 mt-0.5',
                          isSelected
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-muted-foreground/30'
                        )}
                      >
                        {isSelected && <Check className="h-3 w-3" />}
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium">{option.label}</p>
                        {option.description && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {option.description}
                          </p>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>

              {/* 自定义输入 */}
              {question.allowCustom && (
                <div className="space-y-2">
                  {!state.showCustomInput ? (
                    <button
                      type="button"
                      onClick={() => handleToggleCustomInput(question.id)}
                      className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <MessageSquare className="h-3.5 w-3.5" />
                      <span>填写其他答案</span>
                    </button>
                  ) : (
                    <div className="space-y-2">
                      <Input
                        placeholder="请输入您的答案..."
                        value={state.customInput}
                        onChange={e => handleCustomInputChange(question.id, e.target.value)}
                        className="text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => handleToggleCustomInput(question.id)}
                        className="text-xs text-muted-foreground hover:text-foreground"
                      >
                        取消
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* 多选提示 */}
              {question.allowMultiple && (
                <p className="text-xs text-muted-foreground">
                  可多选
                </p>
              )}
            </CardContent>
          </Card>
        )
      })}

      {/* 提交按钮 */}
      <Button
        onClick={handleSubmit}
        disabled={!isAllAnswered || isSubmitting}
        className="w-full"
      >
        {isSubmitting ? '提交中...' : '提交回答'}
      </Button>
    </div>
  )
}
