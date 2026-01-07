import { Suspense } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { Settings, User, DollarSign, Cpu } from 'lucide-react'
import { getSystemConfig, getUserProfile } from '@/app/actions/settings'
import { SystemConfigForm } from '@/components/settings/system-config-form'
import { UserProfileForm } from '@/components/settings/user-profile-form'

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">系统设置</h2>
        <p className="text-muted-foreground">
          管理系统配置和个人资料
        </p>
      </div>

      <div className="grid gap-6">
        {/* 个人资料 */}
        <Suspense fallback={<SettingsSkeleton title="个人资料" />}>
          <UserProfileSection />
        </Suspense>

        <Separator />

        {/* 成本配置 */}
        <Suspense fallback={<SettingsSkeleton title="成本配置" />}>
          <SystemConfigSection />
        </Suspense>

        <Separator />

        {/* AI 模型配置 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Cpu className="h-5 w-5" />
              AI 模型配置
            </CardTitle>
            <CardDescription>
              配置 AI 模型参数（通过环境变量配置）
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md bg-muted p-4">
              <p className="text-sm text-muted-foreground mb-2">
                AI 模型通过环境变量配置，请在服务器端设置以下变量：
              </p>
              <div className="space-y-2 font-mono text-xs">
                <p>
                  <span className="text-muted-foreground">AI_GATEWAY_API_KEY=</span>
                  <span className="text-green-600">your_api_key</span>
                </p>
                <p>
                  <span className="text-muted-foreground">AI_GATEWAY_MODEL=</span>
                  <span className="text-blue-600">anthropic/claude-sonnet-4-20250514</span>
                </p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              支持的模型：Claude Sonnet 4、Claude Opus 4 等
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

async function UserProfileSection() {
  const profile = await getUserProfile()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <User className="h-5 w-5" />
          个人资料
        </CardTitle>
        <CardDescription>管理你的个人信息</CardDescription>
      </CardHeader>
      <CardContent>
        <UserProfileForm profile={profile} />
      </CardContent>
    </Card>
  )
}

async function SystemConfigSection() {
  const config = await getSystemConfig()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DollarSign className="h-5 w-5" />
          成本配置
        </CardTitle>
        <CardDescription>设置默认的成本计算参数</CardDescription>
      </CardHeader>
      <CardContent>
        <SystemConfigForm config={config} />
      </CardContent>
    </Card>
  )
}

function SettingsSkeleton({ title }: { title: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings className="h-5 w-5" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-10 w-full" />
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
