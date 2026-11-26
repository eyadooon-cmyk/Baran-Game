import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
const source=await readFile(new URL("../homscard-analysis.js",import.meta.url),"utf8");
const context={};vm.runInNewContext(source,context);
const engine=context.BaranHomsCardAuditEngine;
test("HomsCard price comparison preserves direction and separates rounding from material differences",()=>{
 assert.equal(engine.priceComparison(1,1.001).band,"فرق طفيف/تقريب");
 assert.ok(engine.priceComparison(1,0.998).deltaPct<0);
 assert.equal(engine.priceComparison(1,1.02).band,"فرق ملحوظ يحتاج مراجعة");
 assert.equal(engine.priceComparison(0,2).comparable,false);
});
test("HomsCard image resolution falls back to extracted supplier page images",()=>{
 assert.equal(engine.imageUrl({product_data:{image:null},page_data:{images:["https://cdn.homscard.com/a.webp"]}}),"https://cdn.homscard.com/a.webp");
 assert.equal(engine.imageUrl({product_data:{image:"http://unsafe.test/a"},page_data:{images:[]}}),null);
});
test("Legacy package warnings remain visible and are counted separately from current issues",()=>{
 const row={product_id:"283",product_data:{id:283,product_type:"package"},audit_data:{missing:["لا توجد خيارات كمية مؤكدة","اسم المنتج"]}};
 assert.equal(engine.savedWarnings(row).length,2);
 assert.equal(engine.legacyWarnings(row).length,1);
 const summary=engine.summarize([row]);
 assert.equal(summary.savedWarningItems,2);
 assert.equal(summary.legacyWarningItems,1);
});
test("HomsCard summary distinguishes API images, page images, page success and unresolved types",()=>{
 const rows=[{product_id:"283",product_data:{id:283,product_type:"package",image:null},page_data:{text:"details",images:["https://cdn.homscard.com/a.webp"]},page_status:"success"},{product_data:{product_type:null},page_status:"failed"}];
 const s=engine.summarize(rows);
 assert.deepEqual(JSON.parse(JSON.stringify(s)),{total:2,pageSuccess:1,pageFailed:1,apiImages:0,pageImages:1,anyImages:1,savedWarningRows:0,savedWarningItems:0,legacyWarningItems:0,unresolvedTypes:1});
});
