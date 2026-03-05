-- 快速估算记录表
CREATE TABLE IF NOT EXISTS quick_estimates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  selected_items JSONB NOT NULL DEFAULT '[]',
  total_hours DECIMAL(10,2) NOT NULL DEFAULT 0,
  total_adjusted_hours DECIMAL(10,2) NOT NULL DEFAULT 0,
  buffer_coefficient DECIMAL(5,2) NOT NULL DEFAULT 1.3,
  labor_cost_per_day DECIMAL(12,2) NOT NULL DEFAULT 1500,
  total_cost DECIMAL(12,2) NOT NULL DEFAULT 0,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_quick_estimates_created_by ON quick_estimates(created_by);
CREATE INDEX IF NOT EXISTS idx_quick_estimates_created_at ON quick_estimates(created_at DESC);

-- RLS
ALTER TABLE quick_estimates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "用户可以查看自己的快速估算" ON quick_estimates
  FOR SELECT USING (auth.uid() = created_by);

CREATE POLICY "用户可以创建快速估算" ON quick_estimates
  FOR INSERT WITH CHECK (auth.uid() = created_by);

CREATE POLICY "用户可以更新自己的快速估算" ON quick_estimates
  FOR UPDATE USING (auth.uid() = created_by);

CREATE POLICY "用户可以删除自己的快速估算" ON quick_estimates
  FOR DELETE USING (auth.uid() = created_by);
