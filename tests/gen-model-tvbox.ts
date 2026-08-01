// tvbox config 指向新 spider
import fs from "fs";
import path from "path";
import { AIYIFAN_MODEL } from "../lib/sites/aiyifan";
import { generateT3SpiderFromModel } from "../lib/model-generator";

const src = generateT3SpiderFromModel(AIYIFAN_MODEL);
const jsPath = path.resolve(__dirname, "../test-output/spider_aiyifan_model_t3.js");
fs.writeFileSync(jsPath, src);
console.log(`spider ${src.length} bytes -> ${jsPath}`);

const config = {
  spider: "",
  sites: [
    {
      key: "aiyifan_model",
      name: "爱壹帆(Model)",
      type: 3,
      api: "http://10.0.2.2:8899/spider_aiyifan_model_t3.js",
      searchable: 1,
      quickSearch: 1,
      filterable: 0,
    },
  ],
  parses: [{ name: "Web", type: 3, url: "Web" }],
  flags: ["aiyifan", "youku", "qq", "iqiyi", "qiyi", "letv", "sohu", "tudou", "pptv", "mgtv", "wasu", "bilibili", "renrenmi"],
  ijk: [],
  ads: [],
};
const cfgPath = path.resolve(__dirname, "../test-output/tvbox_aiyifan_model.json");
fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2));
console.log(`config -> ${cfgPath}`);
