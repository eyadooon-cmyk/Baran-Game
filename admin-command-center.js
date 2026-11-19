(function(){
  "use strict";
  function initBaranCommandCenter(){
    const panel=document.querySelector('[data-admin-panel="overview"]');
    if(!panel||panel.dataset.commandCenterReady==="true")return;
    const head=panel.querySelector(":scope > .admin-subpanel-head");
    if(!head)return;
    const headings=[...panel.querySelectorAll(":scope > .overview-section-heading")];
    if(headings.length<5)return;
    panel.dataset.commandCenterReady="true";
    const config=[
      {id:"summary",label:"نظرة عامة",icon:"✦",hint:"ملخص المتجر والمؤشرات"},
      {id:"health",label:"صحة النظام",icon:"🛡️",hint:"المراقبة والتنبيهات"},
      {id:"ai",label:"مركز Baran AI",icon:"🧠",hint:"المساعد والتحليل الذكي"},
      {id:"actions",label:"الإجراءات",icon:"⚙️",hint:"المعاينة والموافقة"},
      {id:"customers",label:"التواصل",icon:"💬",hint:"إعلانات العملاء"}
    ];
    const nav=document.createElement("div");
    nav.className="baran-command-tabs";
    nav.setAttribute("role","tablist");
    nav.setAttribute("aria-label","أقسام مركز قيادة الإدارة");
    const content=document.createElement("div");
    content.className="baran-command-content";
    const groups=config.map((item,index)=>{
      const section=document.createElement("section");
      section.className="baran-command-section";
      section.dataset.commandSection=item.id;
      section.id="baran-command-"+item.id;
      section.setAttribute("role","tabpanel");
      section.setAttribute("aria-label",item.label);
      const button=document.createElement("button");
      button.type="button";
      button.className="baran-command-tab";
      button.id="baran-command-tab-"+item.id;
      button.setAttribute("role","tab");
      button.setAttribute("aria-controls",section.id);
      button.setAttribute("aria-selected",index===0?"true":"false");
      button.innerHTML='<span class="baran-command-tab-icon" aria-hidden="true">'+item.icon+'</span><span class="baran-command-tab-copy"><strong>'+item.label+'</strong><small>'+item.hint+'</small></span><span class="baran-command-tab-arrow" aria-hidden="true">‹</span>';
      button.addEventListener("click",()=>activate(item.id));
      nav.appendChild(button);
      content.appendChild(section);
      return section;
    });
    function activate(id){
      groups.forEach((group,index)=>{
        const active=config[index].id===id;
        group.hidden=!active;
        const tab=nav.children[index];
        tab.setAttribute("aria-selected",String(active));
        tab.tabIndex=active?0:-1;
        tab.classList.toggle("is-active",active);
      });
      panel.dataset.activeCommandSection=id;
    }
    const firstHeading=headings[0];
    let current=0;
    const original=[...panel.children];
    original.forEach(node=>{
      if(node===head||node===nav||node===content)return;
      if(node.classList&&node.classList.contains("overview-section-heading")){
        const index=headings.indexOf(node);
        if(index>=0)current=Math.min(index,4);
      }
      groups[current].appendChild(node);
    });
    // Any section-specific assistant created after the first render belongs with the AI workspace.
    const observer=new MutationObserver(records=>{
      records.forEach(record=>record.addedNodes.forEach(node=>{
        if(node.nodeType===1&&node.classList.contains("baran-section-assistant")&&node.parentElement===panel){
          groups[2].appendChild(node);
        }
      }));
    });
    observer.observe(panel,{childList:true});
    head.insertAdjacentElement("afterend",nav);
    nav.insertAdjacentElement("afterend",content);
    activate("summary");
    nav.children[0].tabIndex=0;
    nav.addEventListener("keydown",event=>{
      if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;
      event.preventDefault();
      const currentIndex=config.findIndex(item=>item.id===panel.dataset.activeCommandSection);
      let next=currentIndex;
      if(event.key==="Home")next=0;
      else if(event.key==="End")next=config.length-1;
      else next=(currentIndex+(event.key==="ArrowLeft"?1:-1)+config.length)%config.length;
      activate(config[next].id);nav.children[next].focus();
    });
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",initBaranCommandCenter,{once:true});
  else initBaranCommandCenter();
  window.addEventListener("pageshow",initBaranCommandCenter);
})();