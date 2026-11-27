(function(root){
"use strict";
const LEGACY_PACKAGE_WARNINGS=new Set(["نوع المنتج قد يكون افتراضياً من الموصل","لا توجد خيارات كمية مؤكدة"]);
const getData=r=>r?.product_data||r||{};
const list=v=>Array.isArray(v)?v.filter(x=>x!=null&&String(x).trim()).map(String):[];
function imageUrl(r){const d=getData(r);return [d.image,...list(r?.page_data?.images)].find(v=>/^https:\/\//i.test(String(v||"")))||null;}
function priceComparison(apiValue,pageValue){const api=Number(apiValue),page=Number(pageValue);if(!Number.isFinite(api)||api<=0||!Number.isFinite(page)||page<0)return {comparable:false,deltaPct:null,absolutePct:null,band:"غير قابل للمقارنة"};const deltaPct=(page-api)/api*100,absolutePct=Math.abs(deltaPct);return {comparable:true,deltaPct,absolutePct,band:absolutePct<0.25?"فرق طفيف/تقريب":absolutePct<=1?"فرق محدود يحتاج تفسير":"فرق ملحوظ يحتاج مراجعة"};}
function isConfirmedPackage(r){const d=getData(r);return String(d.product_type||"").toLowerCase()==="package";}
function savedWarnings(r){return list(r?.audit_data?.missing);}
function legacyWarnings(r){return isConfirmedPackage(r)?savedWarnings(r).filter(x=>LEGACY_PACKAGE_WARNINGS.has(x)):[];}
function summarize(rows){const data=Array.isArray(rows)?rows:[];return {total:data.length,pageSuccess:data.filter(r=>r.page_status==="success"&&String(r.page_data?.text||"").trim()).length,pageFailed:data.filter(r=>r.page_status!=="success").length,apiImages:data.filter(r=>/^https:\/\//i.test(String(getData(r).image||""))).length,pageImages:data.filter(r=>list(r.page_data?.images).length>0).length,anyImages:data.filter(r=>!!imageUrl(r)).length,savedWarningRows:data.filter(r=>savedWarnings(r).length>0).length,savedWarningItems:data.reduce((n,r)=>n+savedWarnings(r).length,0),legacyWarningItems:data.reduce((n,r)=>n+legacyWarnings(r).length,0),unresolvedTypes:data.filter(r=>!isConfirmedPackage(r)&&!["quantity","package"].includes(String(getData(r).product_type||"").toLowerCase())).length};}
root.BaranHomsCardAuditEngine=Object.freeze({imageUrl,priceComparison,isConfirmedPackage,savedWarnings,legacyWarnings,summarize});
})(typeof globalThis!=="undefined"?globalThis:window);
