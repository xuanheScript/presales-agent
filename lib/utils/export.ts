import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import * as XLSX from 'xlsx'
import type { Project, Requirement, FunctionModule, CostEstimate } from '@/types'
import { DIFFICULTY_MULTIPLIERS, DEFAULT_CONFIG } from '@/constants'

// 难度级别显示名称
const DIFFICULTY_LABELS: Record<string, string> = {
  simple: '简单',
  medium: '中等',
  complex: '复杂',
  very_complex: '非常复杂',
}

interface ExportData {
  project: Project
  requirement: Requirement | null
  functions: FunctionModule[]
  costEstimate: CostEstimate | null
}

/**
 * 生成 PDF 报告
 */
export function generatePDFReport(data: ExportData): void {
  const { project, requirement, functions, costEstimate } = data

  // 创建 PDF 文档
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  })

  // 设置中文字体（使用系统默认字体）
  doc.setFont('helvetica')

  let yPos = 20

  // 标题
  doc.setFontSize(20)
  doc.text('Presales Cost Estimation Report', 105, yPos, { align: 'center' })
  yPos += 15

  // 项目信息
  doc.setFontSize(14)
  doc.text('Project Information', 20, yPos)
  yPos += 8

  doc.setFontSize(10)
  doc.text(`Project Name: ${project.name}`, 20, yPos)
  yPos += 6
  doc.text(`Industry: ${project.industry || 'Not Specified'}`, 20, yPos)
  yPos += 6
  doc.text(`Status: ${project.status}`, 20, yPos)
  yPos += 6
  doc.text(`Created: ${new Date(project.created_at).toLocaleDateString()}`, 20, yPos)
  yPos += 10

  if (project.description) {
    doc.text(`Description: ${project.description}`, 20, yPos)
    yPos += 10
  }

  // 需求分析
  if (requirement?.parsed_content) {
    doc.setFontSize(14)
    doc.text('Requirement Analysis', 20, yPos)
    yPos += 8

    doc.setFontSize(10)
    const parsed = requirement.parsed_content
    doc.text(`Project Type: ${parsed.projectType}`, 20, yPos)
    yPos += 6

    if (parsed.techStack.length > 0) {
      doc.text(`Tech Stack: ${parsed.techStack.join(', ')}`, 20, yPos)
      yPos += 6
    }

    if (parsed.risks.length > 0) {
      doc.text(`Risks: ${parsed.risks.slice(0, 3).join('; ')}`, 20, yPos)
      yPos += 10
    }
  }

  // 功能模块表格
  if (functions.length > 0) {
    doc.setFontSize(14)
    doc.text('Function Modules', 20, yPos)
    yPos += 5

    const tableData = functions.map((fn) => [
      fn.module_name,
      fn.function_name,
      DIFFICULTY_LABELS[fn.difficulty_level] || fn.difficulty_level,
      `${fn.estimated_hours}h`,
    ])

    autoTable(doc, {
      startY: yPos,
      head: [['Module', 'Function', 'Difficulty', 'Hours']],
      body: tableData,
      theme: 'grid',
      styles: { fontSize: 9 },
      headStyles: { fillColor: [66, 66, 66] },
      margin: { left: 20, right: 20 },
    })

    // 获取表格结束位置
    yPos = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? yPos + 50
    yPos += 10

    // 工时汇总
    const totalHours = functions.reduce((sum, fn) => sum + fn.estimated_hours, 0)
    doc.setFontSize(10)
    doc.text(`Total Estimated Hours: ${totalHours} hours`, 20, yPos)
    yPos += 10
  }

  // 成本估算
  if (costEstimate) {
    // 检查是否需要新页面
    if (yPos > 240) {
      doc.addPage()
      yPos = 20
    }

    doc.setFontSize(14)
    doc.text('Cost Estimation', 20, yPos)
    yPos += 8

    doc.setFontSize(10)
    doc.text(`Labor Cost: CNY ${costEstimate.labor_cost.toLocaleString()}`, 20, yPos)
    yPos += 6
    doc.text(`Service Cost: CNY ${costEstimate.service_cost.toLocaleString()}`, 20, yPos)
    yPos += 6
    doc.text(`Infrastructure Cost: CNY ${costEstimate.infrastructure_cost.toLocaleString()}`, 20, yPos)
    yPos += 6
    doc.text(`Risk Buffer: ${costEstimate.buffer_percentage}%`, 20, yPos)
    yPos += 8

    doc.setFontSize(12)
    doc.text(`Total Cost: CNY ${costEstimate.total_cost.toLocaleString()}`, 20, yPos)
    yPos += 10

    // 成本明细
    if (costEstimate.breakdown) {
      const breakdown = costEstimate.breakdown

      const costData = [
        ['Development', `CNY ${breakdown.development.toLocaleString()}`],
        ['Testing', `CNY ${breakdown.testing.toLocaleString()}`],
        ['Deployment', `CNY ${breakdown.deployment.toLocaleString()}`],
        ['Maintenance', `CNY ${breakdown.maintenance.toLocaleString()}`],
      ]

      if (breakdown.thirdPartyServices?.length > 0) {
        breakdown.thirdPartyServices.forEach((service) => {
          costData.push([service.name, `CNY ${service.cost.toLocaleString()}`])
        })
      }

      autoTable(doc, {
        startY: yPos,
        head: [['Cost Item', 'Amount']],
        body: costData,
        theme: 'striped',
        styles: { fontSize: 9 },
        headStyles: { fillColor: [66, 66, 66] },
        margin: { left: 20, right: 20 },
        tableWidth: 100,
      })
    }
  }

  // 页脚
  const pageCount = doc.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFontSize(8)
    doc.text(
      `Generated on ${new Date().toLocaleDateString()} | Page ${i} of ${pageCount}`,
      105,
      290,
      { align: 'center' }
    )
  }

  // 下载文件
  const fileName = `${project.name.replace(/[^a-zA-Z0-9]/g, '_')}_report.pdf`
  doc.save(fileName)
}

/**
 * 生成 Excel 报告
 */
export function generateExcelReport(data: ExportData): void {
  const { project, requirement, functions, costEstimate } = data

  // 创建工作簿
  const wb = XLSX.utils.book_new()

  // Sheet 1: 项目概览
  const overviewData = [
    ['Project Cost Estimation Report'],
    [],
    ['Project Information'],
    ['Project Name', project.name],
    ['Industry', project.industry || 'Not Specified'],
    ['Status', project.status],
    ['Created Date', new Date(project.created_at).toLocaleDateString()],
    ['Description', project.description || ''],
    [],
  ]

  if (requirement?.parsed_content) {
    const parsed = requirement.parsed_content
    overviewData.push(
      ['Requirement Analysis'],
      ['Project Type', parsed.projectType],
      ['Business Goals', parsed.businessGoals.join(', ')],
      ['Key Features', parsed.keyFeatures.join(', ')],
      ['Tech Stack', parsed.techStack.join(', ')],
      ['Risks', parsed.risks.join(', ')],
      []
    )
  }

  if (costEstimate) {
    overviewData.push(
      ['Cost Summary'],
      ['Labor Cost', `${costEstimate.labor_cost}`],
      ['Service Cost', `${costEstimate.service_cost}`],
      ['Infrastructure Cost', `${costEstimate.infrastructure_cost}`],
      ['Risk Buffer', `${costEstimate.buffer_percentage}%`],
      ['Total Cost', `${costEstimate.total_cost}`],
      []
    )
  }

  const overviewSheet = XLSX.utils.aoa_to_sheet(overviewData)
  overviewSheet['!cols'] = [{ wch: 20 }, { wch: 50 }]
  XLSX.utils.book_append_sheet(wb, overviewSheet, 'Overview')

  // Sheet 2: 功能模块
  if (functions.length > 0) {
    const functionsData: (string | number)[][] = [
      ['Module', 'Function', 'Description', 'Difficulty', 'Hours', 'Adjusted Hours'],
    ]

    let totalHours = 0
    let totalAdjustedHours = 0

    functions.forEach((fn) => {
      const multiplier = DIFFICULTY_MULTIPLIERS[fn.difficulty_level] || 1
      const adjustedHours = fn.estimated_hours * multiplier
      totalHours += fn.estimated_hours
      totalAdjustedHours += adjustedHours

      functionsData.push([
        fn.module_name,
        fn.function_name,
        fn.description || '',
        DIFFICULTY_LABELS[fn.difficulty_level] || fn.difficulty_level,
        fn.estimated_hours,
        adjustedHours,
      ])
    })

    functionsData.push(
      [],
      ['Total', '', '', '', totalHours, totalAdjustedHours]
    )

    const functionsSheet = XLSX.utils.aoa_to_sheet(functionsData)
    functionsSheet['!cols'] = [
      { wch: 15 },
      { wch: 20 },
      { wch: 30 },
      { wch: 12 },
      { wch: 10 },
      { wch: 15 },
    ]
    XLSX.utils.book_append_sheet(wb, functionsSheet, 'Functions')
  }

  // Sheet 3: 成本明细
  if (costEstimate?.breakdown) {
    const breakdown = costEstimate.breakdown
    const costData: (string | number)[][] = [
      ['Cost Breakdown'],
      [],
      ['Item', 'Amount (CNY)'],
      ['Development', breakdown.development],
      ['Testing', breakdown.testing],
      ['Deployment', breakdown.deployment],
      ['Maintenance', breakdown.maintenance],
    ]

    if (breakdown.thirdPartyServices?.length > 0) {
      costData.push([], ['Third Party Services'])
      breakdown.thirdPartyServices.forEach((service) => {
        costData.push([service.name, service.cost])
      })
    }

    costData.push(
      [],
      ['Subtotal', costEstimate.labor_cost + costEstimate.service_cost + costEstimate.infrastructure_cost],
      [`Risk Buffer (${costEstimate.buffer_percentage}%)`, costEstimate.total_cost - (costEstimate.labor_cost + costEstimate.service_cost + costEstimate.infrastructure_cost)],
      ['Total', costEstimate.total_cost]
    )

    const costSheet = XLSX.utils.aoa_to_sheet(costData)
    costSheet['!cols'] = [{ wch: 25 }, { wch: 20 }]
    XLSX.utils.book_append_sheet(wb, costSheet, 'Cost Details')
  }

  // 下载文件
  const fileName = `${project.name.replace(/[^a-zA-Z0-9]/g, '_')}_report.xlsx`
  XLSX.writeFile(wb, fileName)
}
