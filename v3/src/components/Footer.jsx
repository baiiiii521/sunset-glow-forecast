export default function Footer() {
  return (
    <footer className="border-t border-line pb-24 pt-16 md:pb-16">
      <div className="mx-auto max-w-[1440px] px-5 md:px-14">
        <div className="grid gap-10 md:grid-cols-3">
          <div>
            <div className="label mb-4">DATA / 数据</div>
            <div className="flex flex-col gap-2 text-sm text-veil">
              <span>Open-Meteo · ECMWF / GFS / ICON</span>
              <span>CAMS 气溶胶 · PM2.5</span>
            </div>
          </div>
          <div>
            <div className="label mb-4">ALGORITHM / 算法</div>
            <div className="flex flex-col gap-2 text-sm text-veil">
              <span>霞分 v2 · 每城按本地日落</span>
              <span>六档：无烧 → 大烧</span>
            </div>
          </div>
          <div>
            <div className="label mb-4">POLICY / 声明</div>
            <div className="flex flex-col gap-2 text-sm text-veil">
              <span>纯静态 · 查询在浏览器端发出</span>
              <span>启发式算法，不是官方预报</span>
            </div>
          </div>
        </div>
        <div className="mt-16 flex items-end justify-between border-t border-line pt-8">
          <div className="font-display text-2xl font-semibold tracking-wide text-mist md:text-3xl">
            藏一片天色
          </div>
          <div className="label">© 2026 GLOW · MIT</div>
        </div>
      </div>
    </footer>
  )
}
