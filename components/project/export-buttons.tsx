'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Download, FileText, FileSpreadsheet, Loader2 } from 'lucide-react'
import { generatePDFReport, generateExcelReport } from '@/lib/utils/export'
import type { Project, Requirement, FunctionModule, CostEstimate } from '@/types'
import { toast } from 'sonner'

interface ExportButtonsProps {
  project: Project
  requirement: Requirement | null
  functions: FunctionModule[]
  costEstimate: CostEstimate | null
}

export function ExportButtons({
  project,
  requirement,
  functions,
  costEstimate,
}: ExportButtonsProps) {
  const [isExporting, setIsExporting] = useState(false)

  const handleExportPDF = async () => {
    setIsExporting(true)
    try {
      generatePDFReport({ project, requirement, functions, costEstimate })
      toast.success('PDF 报告已生成')
    } catch (error) {
      console.error('PDF 导出失败:', error)
      toast.error('PDF 导出失败')
    } finally {
      setIsExporting(false)
    }
  }

  const handleExportExcel = async () => {
    setIsExporting(true)
    try {
      generateExcelReport({ project, requirement, functions, costEstimate })
      toast.success('Excel 报告已生成')
    } catch (error) {
      console.error('Excel 导出失败:', error)
      toast.error('Excel 导出失败')
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" disabled={isExporting}>
          {isExporting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Download className="mr-2 h-4 w-4" />
          )}
          导出报告
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={handleExportPDF}>
          <FileText className="mr-2 h-4 w-4" />
          导出 PDF
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleExportExcel}>
          <FileSpreadsheet className="mr-2 h-4 w-4" />
          导出 Excel
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
