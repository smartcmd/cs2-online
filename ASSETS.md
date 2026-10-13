# Dust II 资源与构建

当前场景保留已取得的 CS2 Dust II 导出文件中的全部 4,542,407 个三角面。打包不减面、不裁掉远处网格、不舍入坐标、不合并邻近顶点。保留源文件的坐标编码和变换矩阵，解码后的世界坐标与索引通过 SHA-256 逐位校验。源文件本身已有的编码会原样保留，不增加新的有损量化。

当前地图资源约 25.4 MiB，包含完整网格、原分辨率的透明轮廓、原创表面材质和雷达。体积优化采用无损字节重排、差分编码、gzip 与缓存。按空间分区进行视锥剔除只影响提交绘制的区域，不删减网格，也不改变碰撞。

场景不附带原版表面贴图。石墙、灰泥、路面、木纹共用一张原创 1536 × 1536 材质图集（`public/maps/surface-atlas.webp`，399,922 字节），金属、布面和植被沿用轻量配色。表面投射、凹凸细节、阳光与天空在浏览器计算，A/B 标记在浏览器生成。

图集通过内置 image_gen 工具生成，随后仅转换尺寸与 WebP 编码。完整生成提示词保存在 [`scripts/material-atlas.prompt.txt`](scripts/material-atlas.prompt.txt)。它是独立创作的表面材质。栏杆、植被、窗框等另保留源材质的单通道透明度数据与 UV，用于正确的裁切和射线遮挡，不携带原版彩色贴图；贴花、双面和深度偏移分别处理。雷达图缩至 512 像素，约 17 KB。渲染、移动碰撞和子弹射线使用同一份几何；机器人使用与原地图坐标一致的导航图。

## 来源

- 地图几何与原始资源归 Valve 所有。处理输入来自 [apich/cs2-web 的地图资源导出](https://github.com/apich/cs2-web/blob/8402338bd765060b4cc0d719ae40f9539373aba7/docs/ASSETS.md)，以 `config/dust2-source-assets.json` 中的 SHA-256 校验文件；仅将这些资源作为离线制作输入，未引入该项目的游戏实现代码。
- 导出工具：[Source 2 Viewer](https://s2v.app/ValveResourceFormat/guides/exporting-maps.html)。导航及坐标数据对应 [Awpy 2000905](https://github.com/pnxenopoulos/awpy-data/releases/tag/2000905)，来源记录中的 CS2 build 为 25175329。
- 浏览器与服务器使用 Three.js 和 three-mesh-bvh；离线工具使用 meshoptimizer 与 sharp。各依赖保留自己的许可证。

## 重新构建

正常启动不需要下载源模型，生成后的 `public/maps/` 已包含运行所需资源。

```sh
npm install
npm run map:source  # 仅开发者首次重建需要，下载原始输入至 .cache/dust2
npm run map:build   # 输出紧凑几何、雷达和校验清单
npm test
```

`.cache/` 不进入 Git 和 Docker 镜像，HTTP 服务也不提供源模型和源贴图。场景使用 D2L1 无损源坐标编码、原变换矩阵、差分索引和 gzip，解码器位于 `shared/dust2-mesh.js`。碰撞来自导出网格；材质、角色运动和玩法仍属于网页版实现，未导入 Source 2 的全部物理与穿透规则。竞技性约束见 `AGENTS.md`，新增测试禁止通过删面或降低坐标精度缩小文件。
