/* =====================================================================
   Wrapped in an IIFE so nothing lands on the global scope and multiple
   DataPages on one page cannot collide.
   ===================================================================== */
(function(){
"use strict";

var ROOT = document.getElementById("sir-details");
if(!ROOT) return;

/* =====================================================================
   ============================= CONFIG ================================
   This is the only block you normally need to edit.
   ===================================================================== */

/* "demo"        - use the built-in synthetic rows (what ships here)
   "caspio-html" - read rows Caspio rendered into hidden per-record blocks
   "caspio-rest" - fetch rows from the Caspio REST API                     */
var DATA_MODE = "caspio-html";

/* Only used when DATA_MODE === "caspio-rest". */
var REST = {
  account : "YOURACCOUNT",     // e.g. c1abcdef  -> https://c1abcdef.caspio.com
  resource: "views/SIR_Details/records", // or "tables/SIR_Data/records"
  token   : "PASTE_BEARER_TOKEN",
  limit   : 1000,              // page size; the loader follows @nextpage
  maxRows : 20000              // client-side safety stop
};

/* Delimiter used inside each multi-value column. Change if your export
   uses something different. */
var MULTI_DELIM = {
  IncidentTypes         : ",",
  CombinedSubtypes      : ",",
  ActionsTaken          : ",",
  AllNeeds              : ",",
  DevelopmentalDiagnoses: "-",
  HealthDiagnoses       : "-",
  Prescriptions         : "-",
  PsychiatricDiagnoses  : "-",
  OtherCDER             : "-"
};

/* Values that mean "yes" in the APS/CPS/Law-enforcement columns. */
var TRUTHY = ["X","x","Y","YES","Yes","yes","TRUE","True","true","1"];

/* =====================================================================
   SCHEMA — the 29 columns of caspio_data_sample.xlsx.
   `t` is the display label, `mono` right-aligns digits, `date` parses as
   a date, `flag` renders as an APS/CPS-style badge.
   If your Caspio fields end up named differently, add the Caspio name to
   ALIAS below rather than renaming things here.
   ===================================================================== */
var SCHEMA = [
  {c:"UCI",                        t:"UCI",                          mono:true},
  {c:"Vendor",                     t:"Vendor #",                     mono:true},
  {c:"SubmittedVendorifDifferent", t:"Submitted Vendor (if different)", mono:true},
  {c:"VendorName",                 t:"Vendor Name"},
  {c:"IncidentDate",               t:"Incident Date",                date:true},
  {c:"RC",                         t:"Regional Center"},
  {c:"ResidenceTypeinCMFPOS",      t:"Residence Type (CMF/POS)"},
  {c:"AgeGroup",                   t:"Age Group"},
  {c:"IncidentNumber",             t:"Incident #",                   mono:true},
  {c:"IncidentTypes",              t:"Incident Type(s)"},
  {c:"VendorNameinSIR",            t:"Vendor Name in SIR"},
  {c:"VendorTypeDetail",           t:"Vendor Type"},
  {c:"OrganizationID",             t:"Organization ID",              mono:true},
  {c:"OrgName",                    t:"Organization"},
  {c:"IncidentDescription",        t:"Incident Description"},
  {c:"SIRFollowupAction",          t:"SIR Follow-up Action"},
  {c:"CombinedSubtypes",           t:"Combined Subtypes"},
  {c:"Perpetrator",                t:"Perpetrator"},
  {c:"ActionsTaken",               t:"Actions Taken"},
  {c:"newtypeonly",                t:"New Type Only"},
  {c:"AllNeeds",                   t:"All Needs"},
  {c:"DevelopmentalDiagnoses",     t:"Developmental Diagnoses"},
  {c:"HealthDiagnoses",            t:"Health Diagnoses"},
  {c:"Prescriptions",              t:"Prescriptions"},
  {c:"PsychiatricDiagnoses",       t:"Psychiatric Diagnoses"},
  {c:"OtherCDER",                  t:"Other CDER"},
  {c:"APSNotified",                t:"APS Notified",                 flag:true},
  {c:"CPSNotified",                t:"CPS Notified",                 flag:true},
  {c:"LawEnforcementNotified",     t:"Law Enforcement Notified",     flag:true}
];

/* Alternate incoming field names -> the canonical names above. */
var ALIAS = {
  "Incident Date":"IncidentDate", "IncidentDate":"IncidentDate",
  "Incident Number":"IncidentNumber", "Incident #":"IncidentNumber",
  "Regional Center":"RC", "RegionalCenter":"RC",
  "Residence Type in CMF/POS":"ResidenceTypeinCMFPOS", "ResidenceTypeinCMF_POS":"ResidenceTypeinCMFPOS",
  "Age Group":"AgeGroup",
  "Incident Types":"IncidentTypes", "Incident Type List Clean":"IncidentTypes",
  "Combined Subtypes":"CombinedSubtypes",
  "Actions Taken":"ActionsTaken",
  "All Needs":"AllNeeds",
  "Vendor Number in SIR":"Vendor",
  "Vendor Name in SIR":"VendorNameinSIR",
  "Submitted Vendor Column":"SubmittedVendorifDifferent",
  "Submitted Vendor if Different":"SubmittedVendorifDifferent",
  "Type of vendor":"VendorTypeDetail", "Vendor Type Detail":"VendorTypeDetail",
  "Incident Description":"IncidentDescription",
  "SIR Follow-up Action":"SIRFollowupAction", "SIR Followup Action":"SIRFollowupAction",
  "Organization ID":"OrganizationID", "Org Name":"OrgName",
  "Developmental Diagnoses":"DevelopmentalDiagnoses",
  "Health Diagnoses":"HealthDiagnoses",
  "Psychiatric Diagnoses":"PsychiatricDiagnoses",
  "Other CDER":"OtherCDER",
  "New Type Only":"newtypeonly", "NewTypeOnly":"newtypeonly",
  "APS Notified":"APSNotified", "CPS Notified":"CPSNotified",
  "Law Enforcement Notified":"LawEnforcementNotified"
};

/* Columns shown in the results grid, in order. */
var GRID = [
  {c:"IncidentDate"}, {c:"UCI"}, {c:"IncidentNumber"}, {c:"RC"},
  {c:"ResidenceTypeinCMFPOS"}, {c:"AgeGroup"},
  {c:"IncidentTypes", wrap:true}, {c:"CombinedSubtypes", wrap:true},
  {c:"Vendor"}, {c:"VendorNameinSIR", wrap:true},
  {c:"__flags", t:"Notified"}
];

/* How the detail panel is grouped. */
var SECTIONS = [
  {title:"Incident", fields:["IncidentDate","IncidentNumber","RC","IncidentTypes","CombinedSubtypes","newtypeonly","Perpetrator","ActionsTaken"]},
  {title:"Individual", fields:["UCI","AgeGroup","ResidenceTypeinCMFPOS","AllNeeds","DevelopmentalDiagnoses","HealthDiagnoses","PsychiatricDiagnoses","Prescriptions","OtherCDER"]},
  {title:"Vendor and organization", fields:["Vendor","SubmittedVendorifDifferent","VendorName","VendorNameinSIR","VendorTypeDetail","OrganizationID","OrgName"]},
  {title:"Notifications", fields:["APSNotified","CPSNotified","LawEnforcementNotified"]},
  {title:"Narrative", narrative:true, fields:["IncidentDescription","SIRFollowupAction"]}
];

/* =====================================================================
   ========================== DEMO DATA ================================
   Delete this whole block once you are live. It exists so the page can
   be reviewed before Caspio is wired up. Values mirror the shapes found
   in caspio_data_sample.xlsx.
   ===================================================================== */
function buildDemo(){
  var rcs=["ACRC","ELARC","FDLRC","GGRC","IRC","NLACRC","RCEB","SARC","VMRC"];
  var resTypes=["SLS","ILS","FHA","CCF Level 2","CCF Level 3","CCF Level 4i","ICF/DD-H","ICF/DD-N","Home of Parent/Guardian","SNF"];
  var ages=["Under 3 years","3 to 17 years","18 to 21 years","22 to 59 years","60 years and older"];
  var types=["Unplanned Medical Hospitalization","Injury","Death","Missing Person","Suspected Abuse or Exploitation","Law Enforcement Contact","Victim of Crime","Restraint","Medication Error"];
  var subs=["Cardiac-related","Respiratory-related","Fall","Seizure","Aspiration/Choking","Physical Abuse","Financial Exploitation","Wandering","Infection","Medication Error"];
  var perps=["Not Applicable","Staff","Peer/Consumer","Family Member","Unknown","Other"];
  var actions=["Increased Clinical Services","Increased Case Management","Referral to Behavioral Services","Staff Retraining","Care Plan Updated","No Further Action Required"];
  var needs=["Behavioral Challenges","Personal Care Needs","Low Mobility","Medical Needs","Communication Needs"];
  var dev=["Mild Intellectual Disability","Moderate Intellectual Disability","Severe Intellectual Disability","Autism","Cerebral Palsy","Epilepsy"];
  var health=["Only Other/Unclassified Seizure Disorder","Diabetes","Cardiac Condition","Respiratory Condition","None Reported"];
  var rx=["Anticonvulsant Medication Prescribed","Antipsychotic Medication Prescribed","Antidepressant Medication Prescribed","No Psychotropic Medications"];
  var psych=["Depressive Disorder According To Cder","Schizophrenia According To Cder","Anxiety Disorder According To Cder","None According To Cder"];
  var ocder=["Substance Or Alcohol Abuse Or Offense (Conviction Or Recent History)","History Of Elopement","Requires Continuous Supervision","None"];
  var orgs=[["MODERN","1111111","MODERN VENDOR GUYS"],["BAYSIDE","2222222","BAYSIDE SUPPORT NETWORK"],["CANYON","3333333","CANYON LIVING SERVICES"],["HARBORPOINT","4444444","HARBOR POINT HOMES"],["SIERRA","5555555","SIERRA COMMUNITY CARE"],["LAKEVIEW","6666666","LAKEVIEW DAY PROGRAMS"]];
  var narr=[
    "Individual fell and fractured their leg. They were transported to the hospital",
    "Individual was found outside the residence without staff supervision and was returned safely",
    "Individual experienced a seizure during the evening shift and was evaluated by paramedics",
    "Individual reported that a peer took money from their room. Law enforcement was contacted",
    "Individual was admitted for an unplanned medical hospitalization following respiratory distress",
    "Individual sustained a minor injury during a scheduled community outing and was treated on site"
  ];
  var follow=[
    "Follow-up: Hospital was contacted by vendor and the individual's family. The nurse informed them they were doing ok.\nAdditional Comment: SC followed up with the residential provider. Client was discharged and prescribed antibiotics and pain medication.",
    "Follow-up: Provider completed an incident review and updated the supervision plan.\nAdditional Comment: SC confirmed the plan was implemented at the next quarterly review.",
    "Follow-up: Behavioral services consulted and a revised behavior plan was submitted.",
    "Follow-up: No further action required. Individual returned to baseline."
  ];

  var rnd=function(a,b){return a+Math.random()*(b-a);};
  var pick=function(a){return a[Math.floor(Math.random()*a.length)];};
  var pickN=function(a,n){var c=a.slice(),o=[];while(o.length<n&&c.length){o.push(c.splice(Math.floor(Math.random()*c.length),1)[0]);}return o;};
  var pad=function(n){return String(n).padStart(2,"0");};
  var lastDay=function(y,m){return new Date(y,m,0).getDate();};

  var rows=[];
  for(var i=0;i<420;i++){
    var y=Math.random()<0.55?2024:2025;
    var m=y===2025?Math.floor(rnd(1,10)):Math.floor(rnd(1,13));
    var d=Math.floor(rnd(1,lastDay(y,m)+1));
    var org=pick(orgs);
    var vtype=pick(resTypes);
    var vend="P"+pick(["V","J","W","A"])+String(Math.floor(rnd(100,999)));
    var t1=pick(types);
    var sirType=Math.random()<0.25?t1+", "+pick(types):t1;
    rows.push({
      "UCI": String(Math.floor(rnd(100000000,999999999))),
      "Vendor": vend,
      "SubmittedVendorifDifferent": Math.random()<0.25?"P"+pick(["J","V"])+String(Math.floor(rnd(1000,9999))):"",
      "VendorName": org[2],
      "IncidentDate": pad(m)+"/"+pad(d)+"/"+y,
      "RC": pick(rcs),
      "ResidenceTypeinCMFPOS": pick(resTypes),
      "AgeGroup": pick(ages),
      "IncidentNumber": String(Math.floor(rnd(70000000,79999999))),
      "IncidentTypes": sirType,
      "VendorNameinSIR": org[2],
      "VendorTypeDetail": vtype,
      "OrganizationID": org[1],
      "OrgName": org[0],
      "IncidentDescription": pick(narr),
      "SIRFollowupAction": Math.random()<0.85?pick(follow):"",
      "CombinedSubtypes": pickN(subs,Math.random()<0.3?2:1).join(", "),
      "Perpetrator": pick(perps),
      "ActionsTaken": pickN(actions,Math.floor(rnd(1,4))).join(", "),
      "newtypeonly": Math.random()<0.2?"Yes":"No",
      "AllNeeds": pickN(needs,Math.floor(rnd(1,4))).join(", "),
      "DevelopmentalDiagnoses": pickN(dev,Math.random()<0.25?2:1).join("-"),
      "HealthDiagnoses": pickN(health,Math.random()<0.3?2:1).join("-"),
      "Prescriptions": pickN(rx,Math.random()<0.4?2:1).join("-"),
      "PsychiatricDiagnoses": pickN(psych,Math.random()<0.3?2:1).join("-"),
      "OtherCDER": pickN(ocder,1).join("-"),
      "APSNotified": Math.random()<0.22?"X":"",
      "CPSNotified": Math.random()<0.08?"X":"",
      "LawEnforcementNotified": Math.random()<0.18?"X":""
    });
  }
  return rows;
}

/* =====================================================================
   =========================== ENGINE ==================================
   ===================================================================== */
var ALL=[], VIEW=[], selected=null;
var sortCol="IncidentDate", sortDir=-1;
var page=1, pageSize=100;

var $=function(s){return ROOT.querySelector(s);};
var $$=function(s){return Array.prototype.slice.call(ROOT.querySelectorAll(s));};
var nf=new Intl.NumberFormat("en-US");
var META={}; SCHEMA.forEach(function(f){META[f.c]=f;});

function labelOf(col){return (META[col]&&META[col].t)||col;}
function esc(s){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
function isBlank(v){return v===undefined||v===null||String(v).trim()==="";}
function truthy(v){return TRUTHY.indexOf(String(v).trim())!==-1;}

/* Accepts MM/DD/YYYY, M/D/YYYY, YYYY-MM-DD and ISO date-times. */
function parseDate(v){
  if(isBlank(v)) return null;
  if(v instanceof Date) return isNaN(v)?null:v;
  var s=String(v).trim();
  var us=s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if(us) return new Date(Date.UTC(+us[3],+us[1]-1,+us[2]));
  var iso=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if(iso) return new Date(Date.UTC(+iso[1],+iso[2]-1,+iso[3]));
  var d=new Date(s);
  return isNaN(d)?null:d;
}
function fmtDate(v){
  var d=parseDate(v);
  return d?d.toLocaleDateString("en-US",{year:"numeric",month:"short",day:"2-digit",timeZone:"UTC"}):"";
}
function isoDate(d){return d.toISOString().slice(0,10);}

/* Split a multi-value cell into trimmed tokens. */
function tokens(row,col){
  var v=row[col];
  if(isBlank(v)) return [];
  var delim=MULTI_DELIM[col];
  if(!delim) return [String(v).trim()];
  return String(v).split(delim).map(function(s){return s.trim();}).filter(function(s){return s!=="";});
}

/* Map incoming keys onto the canonical schema names and normalise. */
function normalize(raw){
  var out={};
  SCHEMA.forEach(function(f){out[f.c]="";});
  Object.keys(raw).forEach(function(k){
    var key=ALIAS[k]||ALIAS[k.replace(/\s+/g,"")]||k;
    if(META[key]) out[key]=raw[k]==null?"":String(raw[k]).trim();
  });
  out.__date=parseDate(out.IncidentDate);
  return out;
}

/* ---------------------- filter controls ---------------------- */
function selects(){return $$("#sdFilters select[data-col]");}
function checks(){return $$("#sdFilters input[type=checkbox][data-col]");}

function fillSelect(sel){
  var col=sel.getAttribute("data-col"), cur=sel.value, seen={}, vals=[];
  ALL.forEach(function(r){
    tokens(r,col).forEach(function(v){if(!seen[v]){seen[v]=1;vals.push(v);}});
  });
  vals.sort(function(a,b){return a.localeCompare(b,undefined,{numeric:true});});
  sel.innerHTML="";
  var all=document.createElement("option"); all.value=""; all.textContent="(All)"; sel.appendChild(all);
  vals.forEach(function(v){
    var o=document.createElement("option"); o.value=v; o.textContent=v; sel.appendChild(o);
  });
  if(cur){for(var i=0;i<sel.options.length;i++){if(sel.options[i].value===cur){sel.value=cur;break;}}}
}

function applyFilters(){
  var picks=[];
  selects().forEach(function(s){ if(s.value) picks.push([s.getAttribute("data-col"),s.value]); });
  var flags=checks().filter(function(c){return c.checked;}).map(function(c){return c.getAttribute("data-col");});
  var uci=$("#sd_uci").value.trim().toLowerCase();
  var vend=$("#sd_vendor").value.trim().toLowerCase();
  var from=$("#sd_from").value?parseDate($("#sd_from").value):null;
  var to  =$("#sd_to").value?parseDate($("#sd_to").value):null;

  VIEW=ALL.filter(function(r){
    for(var i=0;i<picks.length;i++){
      if(tokens(r,picks[i][0]).indexOf(picks[i][1])===-1) return false;
    }
    for(var j=0;j<flags.length;j++){ if(!truthy(r[flags[j]])) return false; }
    if(uci && String(r.UCI).toLowerCase().indexOf(uci)===-1) return false;
    if(vend){
      var v=(String(r.Vendor)+" "+String(r.SubmittedVendorifDifferent)).toLowerCase();
      if(v.indexOf(vend)===-1) return false;
    }
    if(from||to){
      if(!r.__date) return false;
      if(from && r.__date<from) return false;
      if(to && r.__date>to) return false;
    }
    return true;
  });
  sortView();
  page=1;
  render();
}

function sortView(){
  var col=sortCol, dir=sortDir, meta=META[col]||{};
  VIEW.sort(function(a,b){
    var x,y;
    if(meta.date){ x=a.__date?a.__date.getTime():-Infinity; y=b.__date?b.__date.getTime():-Infinity; }
    else if(meta.mono && /^\d+$/.test(a[col]||"") && /^\d+$/.test(b[col]||"")){ x=+a[col]; y=+b[col]; }
    else { x=String(a[col]||"").toLowerCase(); y=String(b[col]||"").toLowerCase(); }
    return (x>y?1:(x<y?-1:0))*dir;
  });
}

/* ---------------------- rendering ---------------------- */
function render(){ drawSummary(); drawTable(); }

function drawSummary(){
  var uci={},ven={},rc={},minD=null,maxD=null;
  VIEW.forEach(function(r){
    if(!isBlank(r.UCI)) uci[r.UCI]=1;
    if(!isBlank(r.Vendor)) ven[r.Vendor]=1;
    if(!isBlank(r.RC)) rc[r.RC]=1;
    if(r.__date){ if(!minD||r.__date<minD)minD=r.__date; if(!maxD||r.__date>maxD)maxD=r.__date; }
  });
  $("#sumRecords").textContent=nf.format(VIEW.length);
  $("#sumUci").textContent=nf.format(Object.keys(uci).length);
  $("#sumVendors").textContent=nf.format(Object.keys(ven).length);
  $("#sumRcs").textContent=nf.format(Object.keys(rc).length);
  $("#sumRange").textContent=minD?(fmtDate(minD)+"  to  "+fmtDate(maxD)):"—";
}

function flagCell(r){
  var out='<span class="flagset">';
  [["APSNotified","APS"],["CPSNotified","CPS"],["LawEnforcementNotified","LE"]].forEach(function(p){
    out+='<span class="tag'+(truthy(r[p[0]])?" on":"")+'" title="'+esc(labelOf(p[0]))+'">'+p[1]+"</span>";
  });
  return out+"</span>";
}

function drawTable(){
  var head=$("#sdHead"); head.innerHTML="";
  GRID.forEach(function(col){
    var th=document.createElement("th");
    th.textContent=(col.t||labelOf(col.c))+" ";
    if(col.c==="__flags"){ th.style.cursor="default"; }
    else{
      if(sortCol===col.c){
        var a=document.createElement("span"); a.className="arrow";
        a.textContent=sortDir<0?"▼":"▲"; th.appendChild(a);
      }
      th.addEventListener("click",function(){
        if(sortCol===col.c) sortDir*=-1; else { sortCol=col.c; sortDir=(META[col.c]&&META[col.c].date)?-1:1; }
        sortView(); page=1; drawTable();
      });
    }
    head.appendChild(th);
  });

  var pages=Math.max(1,Math.ceil(VIEW.length/pageSize));
  if(page>pages) page=pages;
  var start=(page-1)*pageSize, slice=VIEW.slice(start,start+pageSize);

  var body=$("#sdBody"); body.innerHTML="";
  slice.forEach(function(r){
    var tr=document.createElement("tr");
    tr.setAttribute("role","button");
    tr.setAttribute("tabindex","0");
    if(selected===r) tr.setAttribute("aria-selected","true");
    GRID.forEach(function(col){
      var td=document.createElement("td");
      if(col.c==="__flags"){ td.innerHTML=flagCell(r); }
      else{
        var meta=META[col.c]||{};
        var v=r[col.c]==null?"":r[col.c];
        if(meta.date) v=fmtDate(v);
        if(meta.mono) td.className="mono";
        if(col.wrap) td.className=(td.className?td.className+" ":"")+"wrap";
        td.textContent=v;
      }
      tr.appendChild(td);
    });
    var open=function(){ selected=r; drawDetail(r); drawTable(); };
    tr.addEventListener("click",open);
    tr.addEventListener("keydown",function(e){ if(e.key==="Enter"||e.key===" "){e.preventDefault();open();} });
    body.appendChild(tr);
  });

  $("#sdEmpty").style.display=VIEW.length?"none":"block";
  $(".tablewrap").style.display=VIEW.length?"block":"none";

  var shownFrom=VIEW.length?start+1:0, shownTo=Math.min(start+pageSize,VIEW.length);
  $("#sdCount").textContent=VIEW.length
    ? "Showing "+nf.format(shownFrom)+"–"+nf.format(shownTo)+" of "+nf.format(VIEW.length)+" record"+(VIEW.length===1?"":"s")+
      (ALL.length!==VIEW.length?" (filtered from "+nf.format(ALL.length)+")":"")
    : "No records";
  $("#sd_pageno").textContent="Page "+page+" of "+pages;
  $("#sd_prev").disabled=(page<=1);
  $("#sd_next").disabled=(page>=pages);
}

function fieldHtml(col,r,narrative){
  var v=r[col], meta=META[col]||{};
  var html;
  if(meta.date) v=fmtDate(v);
  if(isBlank(v)){
    html='<div class="v empty-v">—</div>';
  }else if(meta.flag){
    html='<div class="v">'+(truthy(v)?"Yes":esc(v))+"</div>";
  }else if(MULTI_DELIM[col]){
    var ts=tokens(r,col);
    html='<div class="v"><div class="chips">'+ts.map(function(t){return '<span class="chip">'+esc(t)+"</span>";}).join("")+"</div></div>";
  }else{
    html='<div class="v">'+esc(v)+"</div>";
  }
  return '<div class="field"><div class="k">'+esc(labelOf(col))+"</div>"+html+"</div>";
}

function drawDetail(r){
  var box=$("#sdDetail");
  if(!r){
    box.innerHTML='<div class="detail-placeholder">Select a record above to see the full incident detail.</div>';
    return;
  }
  var html='<div class="detail-hd">'+
    '<span class="pill mono">UCI '+esc(r.UCI||"—")+"</span>"+
    "<h3>Incident "+esc(r.IncidentNumber||"—")+"</h3>"+
    '<span class="date">'+esc(fmtDate(r.IncidentDate)||"date not recorded")+"</span></div>";

  SECTIONS.forEach(function(sec){
    html+='<div class="sect"><h4>'+esc(sec.title)+'</h4><div class="body'+(sec.narrative?" narrative":"")+'">';
    sec.fields.forEach(function(col){ html+=fieldHtml(col,r,sec.narrative); });
    html+="</div></div>";
  });
  box.innerHTML=html;
}

/* ---------------------- wiring ---------------------- */
function initControls(){
  selects().forEach(function(s){
    fillSelect(s);
    s.addEventListener("change",function(){ selected=null; drawDetail(null); applyFilters(); });
  });
  checks().forEach(function(c){
    c.addEventListener("change",function(){ selected=null; drawDetail(null); applyFilters(); });
  });
  ["#sd_uci","#sd_vendor"].forEach(function(id){
    $(id).addEventListener("input",function(){ selected=null; drawDetail(null); applyFilters(); });
  });
  ["#sd_from","#sd_to"].forEach(function(id){
    $(id).addEventListener("change",function(){ selected=null; drawDetail(null); applyFilters(); });
  });
  $("#sd_pagesize").addEventListener("change",function(){ pageSize=+this.value||100; page=1; drawTable(); });
  $("#sd_prev").addEventListener("click",function(){ if(page>1){page--;drawTable();} });
  $("#sd_next").addEventListener("click",function(){ page++;drawTable(); });
  $("#sd_reset").addEventListener("click",function(){
    selects().forEach(function(s){s.value="";});
    checks().forEach(function(c){c.checked=false;});
    $("#sd_uci").value=""; $("#sd_vendor").value="";
    $("#sd_from").value=""; $("#sd_to").value="";
    selected=null; drawDetail(null); applyFilters();
  });

  var ds=ALL.map(function(r){return r.__date;}).filter(Boolean).sort(function(a,b){return a-b;});
  if(ds.length){
    var lo=isoDate(ds[0]), hi=isoDate(ds[ds.length-1]);
    $("#sd_from").min=$("#sd_to").min=lo;
    $("#sd_from").max=$("#sd_to").max=hi;
    $("#sdThrough").textContent=fmtDate(ds[ds.length-1]);
  }
}

function start(rawRows){
  ALL=(rawRows||[]).map(normalize);
  initControls();
  applyFilters();
  drawDetail(null);
}

/* =====================================================================
   ========================= DATA LOADERS ==============================
   ===================================================================== */

/* MODE "caspio-html"
   Caspio renders one hidden block per record (see the guide). Each block
   is <span data-sir-rec> with one child per field carrying data-k.
   Reading textContent means quotes, apostrophes and newlines in the
   narrative fields cannot break anything. */
function readEmbeddedRows(){
  var blocks=document.querySelectorAll("[data-sir-rec]");
  var out=[];
  for(var i=0;i<blocks.length;i++){
    var cells=blocks[i].querySelectorAll("[data-k]"), row={};
    for(var j=0;j<cells.length;j++){
      row[cells[j].getAttribute("data-k")]=cells[j].textContent;
    }
    out.push(row);
  }
  return out;
}

/* Caspio results may be injected asynchronously, so poll briefly. */
function loadEmbedded(){
  var tries=0;
  var timer=setInterval(function(){
    var rows=readEmbeddedRows();
    if(rows.length){ clearInterval(timer); start(rows); }
    else if(++tries>60){ clearInterval(timer); start([]); }
  },100);
}

/* MODE "caspio-rest" — follows @nextpage until done or maxRows. */
function loadRest(){
  var base="https://"+REST.account+".caspio.com/rest/v2/"+REST.resource;
  var rows=[];
  function fetchPage(pageNo){
    var url=base+"?q.limit="+REST.limit+"&q.pageNumber="+pageNo;
    return fetch(url,{headers:{Authorization:"bearer "+REST.token,Accept:"application/json"}})
      .then(function(res){
        if(!res.ok) throw new Error("Caspio REST "+res.status+" "+res.statusText);
        return res.json();
      })
      .then(function(j){
        var batch=j.Result||[];
        rows=rows.concat(batch);
        if(batch.length===REST.limit && rows.length<REST.maxRows) return fetchPage(pageNo+1);
        return rows;
      });
  }
  /* Two-argument then(), so a failure inside start() is not mistaken for a
     failed download. */
  fetchPage(1).then(function(rows){ start(rows); }, function(err){
    if(window.console) console.error("SIR details: Caspio REST load failed:",err);
    ROOT.querySelector("#sdEmpty").innerHTML="<strong>Could not load data from Caspio</strong>See the browser console for the error returned by the REST API.";
    start([]);
  });
}

function boot(){
  try{
    if(DATA_MODE==="caspio-html") loadEmbedded();
    else if(DATA_MODE==="caspio-rest") loadRest();
    else start(buildDemo());
  }catch(err){
    if(window.console) console.error("SIR details init failed:",err);
  }
}
boot();

})();
