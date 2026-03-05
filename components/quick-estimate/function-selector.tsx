'use client'

import { useMemo, useState } from 'react'
import { Search, ChevronDown, ChevronRight, Package } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import type { FunctionLibraryItem, FunctionGroupWithItems } from '@/types'

type ViewMode = 'category' | 'group'

interface FunctionSelectorProps {
  items: FunctionLibraryItem[]
  groups: FunctionGroupWithItems[]
  selectedIds: Set<string>
  onToggle: (item: FunctionLibraryItem) => void
  onAddGroup: (group: FunctionGroupWithItems) => void
}

export function FunctionSelector({
  items,
  groups,
  selectedIds,
  onToggle,
  onAddGroup,
}: FunctionSelectorProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('group')
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set())
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

  // 功能库 Map，用于在组视图中查找完整的 FunctionLibraryItem
  const itemMap = useMemo(() => {
    const map = new Map<string, FunctionLibraryItem>()
    for (const item of items) {
      map.set(item.id, item)
    }
    return map
  }, [items])

  const categories = useMemo(() => {
    const cats = [...new Set(items.map((item) => item.category))]
    return cats.sort()
  }, [items])

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (categoryFilter !== 'all' && item.category !== categoryFilter) return false
      if (search) {
        const keyword = search.toLowerCase()
        return (
          item.function_name.toLowerCase().includes(keyword) ||
          item.description?.toLowerCase().includes(keyword)
        )
      }
      return true
    })
  }, [items, search, categoryFilter])

  const groupedItems = useMemo(() => {
    const groups: Record<string, FunctionLibraryItem[]> = {}
    for (const item of filteredItems) {
      if (!groups[item.category]) {
        groups[item.category] = []
      }
      groups[item.category].push(item)
    }
    return groups
  }, [filteredItems])

  // 过滤功能组
  const filteredGroups = useMemo(() => {
    if (!search) return groups
    const keyword = search.toLowerCase()
    return groups.filter(
      (g) =>
        g.name.toLowerCase().includes(keyword) ||
        g.description?.toLowerCase().includes(keyword) ||
        g.items.some((item) => item.function_name.toLowerCase().includes(keyword))
    )
  }, [groups, search])

  const toggleCategory = (category: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(category)) {
        next.delete(category)
      } else {
        next.add(category)
      }
      return next
    })
  }

  const toggleGroupCollapse = (groupId: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) {
        next.delete(groupId)
      } else {
        next.add(groupId)
      }
      return next
    })
  }

  return (
    <div className="space-y-4">
      {/* 视图切换 + 搜索筛选 */}
      <div className="flex gap-2">
        <div className="flex rounded-md border p-0.5 shrink-0">
          <button
            type="button"
            className={`px-3 py-1 text-sm rounded-sm transition-colors ${viewMode === 'group'
                ? 'bg-primary text-primary-foreground'
                : 'hover:bg-muted'
              }`}
            onClick={() => setViewMode('group')}
          >
            按功能组
          </button>
          <button
            type="button"
            className={`px-3 py-1 text-sm rounded-sm transition-colors ${viewMode === 'category'
                ? 'bg-primary text-primary-foreground'
                : 'hover:bg-muted'
              }`}
            onClick={() => setViewMode('category')}
          >
            按分类
          </button>
        </div>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={viewMode === 'category' ? '搜索功能...' : '搜索功能组...'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        {viewMode === 'category' && (
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-[140px] shrink-0">
              <SelectValue placeholder="全部分类" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部分类</SelectItem>
              {categories.map((cat) => (
                <SelectItem key={cat} value={cat}>
                  {cat}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* 按分类视图 */}
      {viewMode === 'category' && (
        <div className="space-y-2 pb-20 lg:pb-0">
          {Object.entries(groupedItems).map(([category, categoryItems]) => {
            const isCollapsed = collapsedCategories.has(category)
            const selectedCount = categoryItems.filter((item) => selectedIds.has(item.id)).length

            return (
              <Collapsible key={category} open={!isCollapsed} onOpenChange={() => toggleCategory(category)}>
                <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm font-medium hover:bg-muted">
                  {isCollapsed ? (
                    <ChevronRight className="h-4 w-4 shrink-0" />
                  ) : (
                    <ChevronDown className="h-4 w-4 shrink-0" />
                  )}
                  <span>{category}</span>
                  <Badge variant="secondary" className="ml-1">
                    {categoryItems.length}
                  </Badge>
                  {selectedCount > 0 && (
                    <Badge className="ml-auto">
                      已选 {selectedCount}
                    </Badge>
                  )}
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="space-y-0.5 pl-2">
                    {categoryItems.map((item) => (
                      <label
                        key={item.id}
                        className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-md px-3 py-2 hover:bg-muted"
                      >
                        <Checkbox
                          checked={selectedIds.has(item.id)}
                          onCheckedChange={() => onToggle(item)}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium truncate">{item.function_name}</span>
                          </div>
                          {item.description && (
                            <p className="text-xs text-muted-foreground truncate">{item.description}</p>
                          )}
                        </div>
                        <Badge variant="outline" className="shrink-0 tabular-nums">
                          {item.standard_hours}h
                        </Badge>
                      </label>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )
          })}

          {Object.keys(groupedItems).length === 0 && (
            <div className="py-8 text-center text-sm text-muted-foreground">
              未找到匹配的功能
            </div>
          )}
        </div>
      )}

      {/* 按功能组视图 */}
      {viewMode === 'group' && (
        <div className="space-y-2 pb-20 lg:pb-0">
          {filteredGroups.map((group) => {
            const isCollapsed = collapsedGroups.has(group.id)
            const selectedInGroup = group.items.filter(
              (item) => selectedIds.has(item.function_library_id)
            ).length
            const allSelected = group.items.length > 0 && selectedInGroup === group.items.length

            return (
              <Collapsible key={group.id} open={!isCollapsed} onOpenChange={() => toggleGroupCollapse(group.id)}>
                <div className="rounded-md px-2 py-2 hover:bg-muted">
                  <div className="flex items-center gap-2">
                    <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-2 text-sm font-medium">
                      {isCollapsed ? (
                        <ChevronRight className="h-4 w-4 shrink-0" />
                      ) : (
                        <ChevronDown className="h-4 w-4 shrink-0" />
                      )}
                      <Package className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{group.name}</span>
                      {group.is_preset && (
                        <Badge variant="secondary" className="shrink-0 text-xs">预设</Badge>
                      )}
                    </CollapsibleTrigger>
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0 text-xs h-7"
                      onClick={(e) => {
                        e.stopPropagation()
                        onAddGroup(group)
                      }}
                      disabled={allSelected}
                    >
                      {allSelected ? '已全部添加' : '添加整组'}
                    </Button>
                  </div>
                  <div className="flex items-center gap-2 mt-1 pl-6">
                    <Badge variant="outline" className="text-xs tabular-nums">
                      {group.item_count} 个 · {group.total_standard_hours}h
                    </Badge>
                    {selectedInGroup > 0 && (
                      <Badge className="text-xs">
                        已选 {selectedInGroup}/{group.items.length}
                      </Badge>
                    )}
                  </div>
                </div>
                <CollapsibleContent>
                  <div className="space-y-0.5 pl-6">
                    {group.description && (
                      <p className="text-xs text-muted-foreground px-3 pb-1">{group.description}</p>
                    )}
                    {group.items.map((groupItem) => {
                      const fullItem = itemMap.get(groupItem.function_library_id)
                      if (!fullItem) return null

                      return (
                        <label
                          key={groupItem.function_library_id}
                          className="flex min-h-[40px] cursor-pointer items-center gap-2 rounded-md px-3 py-1.5 hover:bg-muted"
                        >
                          <Checkbox
                            checked={selectedIds.has(groupItem.function_library_id)}
                            onCheckedChange={() => onToggle(fullItem)}
                          />
                          <span className="text-sm truncate min-w-0 flex-1">{groupItem.function_name}</span>
                          <Badge variant="outline" className="shrink-0 text-xs tabular-nums hidden sm:inline-flex">
                            {groupItem.category}
                          </Badge>
                          <Badge variant="outline" className="shrink-0 text-xs tabular-nums">
                            {groupItem.standard_hours}h
                          </Badge>
                        </label>
                      )
                    })}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )
          })}

          {filteredGroups.length === 0 && (
            <div className="py-8 text-center text-sm text-muted-foreground">
              {search ? '未找到匹配的功能组' : '暂无功能组，请在功能库中创建'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
