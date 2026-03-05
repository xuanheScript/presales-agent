'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { ChevronDown, ChevronRight, Clock, Layers, Package, Plus } from 'lucide-react'
import { FunctionGroupActions } from './function-group-actions'
import { FunctionGroupDialog } from './function-group-dialog'
import type { FunctionGroupWithItems, FunctionLibraryItem } from '@/types'

interface FunctionGroupListProps {
  groups: FunctionGroupWithItems[]
  allFunctions: FunctionLibraryItem[]
}

export function FunctionGroupList({ groups, allFunctions }: FunctionGroupListProps) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  const toggleGroup = (groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) {
        next.delete(groupId)
      } else {
        next.add(groupId)
      }
      return next
    })
  }

  if (groups.length === 0) {
    return (
      <>
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            将常用功能打包成组，在快速估算时可一键添加
          </p>
          <FunctionGroupDialog allFunctions={allFunctions}>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              新建功能组
            </Button>
          </FunctionGroupDialog>
        </div>
        <Card>
          <CardContent className="py-12">
            <div className="text-center text-muted-foreground">
              <Package className="mx-auto h-12 w-12 mb-4 opacity-50" />
              <p className="font-medium">暂无功能组</p>
              <p className="text-sm mt-1">创建你的第一个功能组，将常用功能打包在一起</p>
            </div>
          </CardContent>
        </Card>
      </>
    )
  }

  // 统计信息
  const totalGroups = groups.length
  const presetCount = groups.filter((g) => g.is_preset).length
  const customCount = totalGroups - presetCount

  return (
    <div className="space-y-6">
      {/* 描述与新建按钮 */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          将常用功能打包成组，在快速估算时可一键添加
        </p>
        <FunctionGroupDialog allFunctions={allFunctions}>
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            新建功能组
          </Button>
        </FunctionGroupDialog>
      </div>

      {/* 统计卡片 */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>功能组总数</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalGroups}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>预设组</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold flex items-center gap-1">
              <Layers className="h-5 w-5 text-muted-foreground" />
              {presetCount}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>自定义组</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{customCount}</div>
          </CardContent>
        </Card>
      </div>

      {/* 组列表 */}
      <div className="space-y-3">
        {groups.map((group) => {
          const isExpanded = expandedGroups.has(group.id)
          // 按分类统计组内功能
          const categoryStats: Record<string, number> = {}
          for (const item of group.items) {
            categoryStats[item.category] = (categoryStats[item.category] || 0) + 1
          }

          return (
            <Card key={group.id}>
              <Collapsible open={isExpanded} onOpenChange={() => toggleGroup(group.id)}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CollapsibleTrigger className="flex items-center gap-2 hover:opacity-80 cursor-pointer">
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 shrink-0" />
                      ) : (
                        <ChevronRight className="h-4 w-4 shrink-0" />
                      )}
                      <div className="text-left">
                        <CardTitle className="text-base flex items-center gap-2">
                          {group.name}
                          {group.is_preset && (
                            <Badge variant="secondary" className="text-xs">预设</Badge>
                          )}
                        </CardTitle>
                        <CardDescription className="mt-1">
                          {group.description || '无描述'}
                        </CardDescription>
                      </div>
                    </CollapsibleTrigger>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-3 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Layers className="h-3.5 w-3.5" />
                          {group.item_count} 个功能
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5" />
                          {group.total_standard_hours}h
                        </span>
                      </div>
                      <div className="flex gap-1">
                        {Object.keys(categoryStats).slice(0, 3).map((cat) => (
                          <Badge key={cat} variant="outline" className="text-xs">
                            {cat}
                          </Badge>
                        ))}
                        {Object.keys(categoryStats).length > 3 && (
                          <Badge variant="outline" className="text-xs">
                            +{Object.keys(categoryStats).length - 3}
                          </Badge>
                        )}
                      </div>
                      <FunctionGroupActions
                        group={group}
                        groupItems={group.items}
                        allFunctions={allFunctions}
                      />
                    </div>
                  </div>
                </CardHeader>
                <CollapsibleContent>
                  <CardContent className="pt-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>功能名称</TableHead>
                          <TableHead>分类</TableHead>
                          <TableHead>描述</TableHead>
                          <TableHead className="text-right">标准工时</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {group.items.map((item) => (
                          <TableRow key={item.id}>
                            <TableCell className="font-medium">
                              {item.function_name}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-xs">
                                {item.category}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-muted-foreground max-w-[200px] truncate">
                              {item.description || '-'}
                            </TableCell>
                            <TableCell className="text-right">
                              <Badge variant="outline" className="font-mono">
                                {item.standard_hours}h
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </CollapsibleContent>
              </Collapsible>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
