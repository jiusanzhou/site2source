/**
 * @site2source/core - 主入口
 *
 * 直接 import 具体子路径也可以:
 *   import { SiteModel } from "@site2source/core/site-model";
 *   import { generateT3SpiderFromModel } from "@site2source/core/generators/t3-spider";
 */
export * from "./site-model";
export { generateT3SpiderFromModel } from "./generators/t3-spider";
export { makeAiyifanModel, AIYIFAN_MODEL } from "./sites/aiyifan";
