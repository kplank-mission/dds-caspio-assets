/* =====================================================================
   Wrapped in an IIFE so nothing lands on the global scope and multiple
   DataPages on one page cannot collide.
   ===================================================================== */
(function(){
"use strict";

/* The header may load this file twice (the <script> tag AND the loader
   shim, see sir_details_header.html). Run once. */
if(window.__sirDetailsBooted) return;
window.__sirDetailsBooted = true;

/* Assigned by whenRoot() at the bottom — Caspio can inject the DataPage
   HTML after this file has already run. */
var ROOT = null;

/* =====================================================================
   ============================= CONFIG ================================
   This is the only block you normally need to edit.
   ===================================================================== */

/* "demo"        - use the built-in synthetic rows (what ships here)
   "caspio-html" - read rows Caspio rendered into hidden per-record blocks
   "caspio-rest" - fetch rows from the Caspio REST API                     */
var DATA_MODE = "caspio-html";

/* How long to wait for Caspio's per-record blocks to appear before giving
   up. A no-parameter load of the whole table is far slower than a
   single-RC slice, so this is generous on purpose. */
var WAIT_MS = 180000;

/* Wall-clock timing, so an unparameterised load can be measured.
   Reported to the console and, if the header has a #sdPerf element,
   printed on the page. */
function nowMs(){
  return (window.performance && window.performance.now) ? window.performance.now() : +new Date();
}
var T0 = nowMs(), PERF = {};

function reportPerf(){
  var wait  = Math.round(PERF.blocks - T0);
  var parse = Math.round(PERF.done   - PERF.blocks);
  var total = Math.round(PERF.done   - T0);
  var line  = PERF.rows.toLocaleString()+" records  ·  waited on Caspio "+(wait/1000).toFixed(1)+
              "s  ·  render "+(parse/1000).toFixed(1)+"s  ·  script total "+(total/1000).toFixed(1)+"s";
  /* performance.now() counts from navigation start, so this covers Caspio's
     server time and the HTML download as well — the number a user feels. */
  if(window.performance && window.performance.now){
    line += "  ·  since page open "+(PERF.done/1000).toFixed(1)+"s";
  }
  if(window.console) console.log("SIR details timing: "+line);
  var el = ROOT && ROOT.querySelector("#sdPerf");
  if(el) el.textContent = line;
}

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

/* Caspio caps how many records a DataPage returns. When the row count comes
   back at exactly the cap, the result was truncated and every count, tile
   and cross-filter total on the page is an undercount — so say so loudly
   rather than letting a partial load pass for a complete one.
   Change this if the DataPage's "Maximum number of records" is changed. */
var LOAD_CAP = 999;

/* =====================================================================
   SCOPE — the server-side cut Caspio applies BEFORE the page loads.
   The scope bar writes these onto the page URL and reloads; the DataPage's
   filtering criteria read them as external parameters. Only one scope's
   worth of rows is ever in the browser, so the sidebar filters, the summary
   tiles and every dropdown describe the CURRENT SCOPE, not the whole table.
   That is why the scope line under the header is always visible.

   `rcs` has to be listed here — it cannot be derived from the data, because
   a single-RC scope only ever contains that one RC. Replace this list with
   your real Regional Center codes exactly as they appear in the RC column.
   ===================================================================== */
var SCOPE = {
  param : {rc:"RC", from:"From", to:"To"},  // URL / Caspio parameter names
  rcs   : ["ACRC", "CVRC", "ELARC","FDLRC", "FNRC", "GGRC", "HRC", "IRC", "KRC", "NBRC", "NLACRC","RCEB", "RCOC", "RCRC", "SARC", "SCLARC", "SDRC", "SGPRC", "TCRC", "VMRC", "WRC"],
  allRc : true,        // false = force a single RC, no "All" option

  /* Domain of the scope date slider. It cannot be read from the data —
     the slider has to offer dates that are NOT in the current slice, since
     its whole job is to fetch a different one. Set `max` to "" for today. */
  minDate: "2019-01-01",
  maxDate: ""
};

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

/* How the detail panel is grouped. Order matters: the narrative renders
   first and full width (it is the part people actually read and it needs
   the measure), and the four that follow pair up two across. */
var SECTIONS = [
  {title:"Narrative", narrative:true, fields:["IncidentDescription","SIRFollowupAction"]},
  {title:"Incident", fields:["IncidentDate","IncidentNumber","RC","IncidentTypes","CombinedSubtypes","newtypeonly","Perpetrator","ActionsTaken"]},
  {title:"Individual", fields:["UCI","AgeGroup","ResidenceTypeinCMFPOS","AllNeeds","DevelopmentalDiagnoses","HealthDiagnoses","PsychiatricDiagnoses","Prescriptions","OtherCDER"]},
  {title:"Vendor and organization", fields:["Vendor","SubmittedVendorifDifferent","VendorName","VendorNameinSIR","VendorTypeDetail","OrganizationID","OrgName"]},
  {title:"Notifications", fields:["APSNotified","CPSNotified","LawEnforcementNotified"]}
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
/* ALL   - every row Caspio delivered for the current scope
   BASE  - ALL after the sidebar filters, but BEFORE the cross-filter panels
   VIEW  - BASE after the cross-filter panels; what the grid shows
   Keeping BASE separate is what lets each cross-filter panel be counted
   against the OTHER panel's selection without counting against its own. */
var ALL=[], BASE=[], VIEW=[], selected=null;
var sortCol="IncidentDate", sortDir=-1;
var page=1, pageSize=100;

/* Cross-filter selections. null = nothing picked in that panel. */
var xfVendor=null, xfUci=null;

/* Rows rendered per cross-filter panel. An unparameterised load can hold
   tens of thousands of distinct UCIs; building that many <tr> on every
   keystroke is what would make the sidebar feel slow. */
var XF_MAX=200;

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

/* ---------------------- dual-handle date slider ----------------------
   Two overlaid <input type=range>, which is the only way to get a
   two-thumb slider without a library. Positions are whole days from the
   domain start, so the arrow keys move one day at a time and the value is
   always a real date rather than a percentage.

   The slider never owns the value: the pair of <input type=date> boxes
   does. The slider writes into them and reads back out of them, so typing
   a date and dragging a handle stay in agreement, and everything else on
   the page keeps reading the boxes exactly as before.
   --------------------------------------------------------------------- */
var DAY_MS = 86400000;

function dayIndex(iso, originMs){
  var d = parseDate(iso);
  return d ? Math.round((d.getTime()-originMs)/DAY_MS) : null;
}
function indexIso(i, originMs){
  return isoDate(new Date(originMs + i*DAY_MS));
}

function makeDateSlider(host, opts){
  if(!host) return null;
  var originMs = parseDate(opts.min) && parseDate(opts.min).getTime();
  var lastIdx  = dayIndex(opts.max, originMs);
  if(originMs==null || lastIdx==null || lastIdx<1){ host.hidden=true; return null; }
  host.hidden=false;

  host.innerHTML =
    '<div class="dsl">'+
      '<div class="dsl-rail"><div class="dsl-fill"></div></div>'+
      '<input type="range" class="dsl-r dsl-lo" min="0" max="'+lastIdx+'" step="1" aria-label="Range start">'+
      '<input type="range" class="dsl-r dsl-hi" min="0" max="'+lastIdx+'" step="1" aria-label="Range end">'+
    '</div>'+
    '<div class="dsl-out"><span class="dsl-v lo">—</span><span class="dsl-sep">to</span><span class="dsl-v hi">—</span></div>';

  var lo=host.querySelector(".dsl-lo"), hi=host.querySelector(".dsl-hi"),
      fill=host.querySelector(".dsl-fill"),
      outLo=host.querySelector(".dsl-v.lo"), outHi=host.querySelector(".dsl-v.hi");

  function paint(){
    var a=+lo.value, b=+hi.value;
    fill.style.left  = (a/lastIdx*100)+"%";
    fill.style.width = ((b-a)/lastIdx*100)+"%";
    outLo.textContent = isoToUs(indexIso(a,originMs));
    outHi.textContent = isoToUs(indexIso(b,originMs));
    /* A whole-domain selection is "no filter", so show it that way rather
       than as a date range the user never chose. */
    host.classList.toggle("full", a===0 && b===lastIdx);
  }

  /* Boxes -> slider. A blank box means "open end", which is the domain edge. */
  function sync(){
    var a=dayIndex(opts.fromEl.value,originMs), b=dayIndex(opts.toEl.value,originMs);
    lo.value = Math.max(0, Math.min(lastIdx, a==null?0:a));
    hi.value = Math.max(0, Math.min(lastIdx, b==null?lastIdx:b));
    if(+lo.value > +hi.value){ var t=lo.value; lo.value=hi.value; hi.value=t; }
    paint();
  }

  /* Slider -> boxes. Handles are not allowed to cross. */
  function push(){
    var a=+lo.value, b=+hi.value;
    if(a>b){ if(document.activeElement===lo) hi.value=a; else lo.value=b; a=+lo.value; b=+hi.value; }
    opts.fromEl.value = a===0       ? "" : indexIso(a,originMs);
    opts.toEl.value   = b===lastIdx ? "" : indexIso(b,originMs);
    paint();
  }

  [lo,hi].forEach(function(el){
    el.addEventListener("input",push);
    /* Filtering on every pixel of a drag would re-scan every row; commit
       when the handle is released instead. */
    el.addEventListener("change",function(){ push(); if(opts.onCommit) opts.onCommit(); });
  });

  sync();
  return {sync:sync};
}

var dslSide=null, dslScope=null;

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
  syncClears();
  var picks=[];
  selects().forEach(function(s){ if(s.value) picks.push([s.getAttribute("data-col"),s.value]); });
  var flags=checks().filter(function(c){return c.checked;}).map(function(c){return c.getAttribute("data-col");});
  var uci=$("#sd_uci").value.trim().toLowerCase();
  var vend=$("#sd_vendor").value.trim().toLowerCase();
  var from=$("#sd_from").value?parseDate($("#sd_from").value):null;
  var to  =$("#sd_to").value?parseDate($("#sd_to").value):null;

  BASE=ALL.filter(function(r){
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

  /* A cross-filter pick that the sidebar has just filtered away would leave
     an empty grid and no obvious way back, so drop it. */
  if(xfVendor!==null && !BASE.some(function(r){return String(r.Vendor||"")===xfVendor;})) xfVendor=null;
  if(xfUci!==null    && !BASE.some(function(r){return String(r.UCI||"")===xfUci;}))       xfUci=null;

  applyCross();
}

/* BASE -> VIEW. Called on its own when only a cross-filter panel changed,
   so the sidebar predicate does not have to run again. */
function applyCross(){
  VIEW=BASE.filter(function(r){
    if(xfVendor!==null && String(r.Vendor||"")!==xfVendor) return false;
    if(xfUci!==null    && String(r.UCI||"")   !==xfUci)    return false;
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
function render(){
  drawSummary(); drawXf(); drawTable();
  /* The hidden page still costs nothing until it is asked for, but the
     visible one has to be redrawn on every filter change. */
  if(VIEWPAGE==="timeline") drawTimeline();
}

/* ---------------------- cross-filter panels ----------------------
   Counts are incidents (rows), not distinct anything: one row is one
   incident record, which is what "incident count" means in the Power BI
   report these panels mirror.

   Each panel is counted against the sidebar filters PLUS the other panel's
   selection, but not its own — the same convention Power BI uses, so a
   vendor stays visible in its own list after you click it.               */

function countBy(rows,col,labelCol){
  var map={}, out=[];
  for(var i=0;i<rows.length;i++){
    var r=rows[i], k=String(r[col]==null?"":r[col]).trim();
    if(!k) continue;
    var e=map[k];
    if(!e){ e=map[k]={key:k,n:0,label:""}; out.push(e); }
    e.n++;
    if(labelCol && !e.label) e.label=String(r[labelCol]||"").trim();
  }
  out.sort(function(a,b){
    return (b.n-a.n) || a.key.localeCompare(b.key,undefined,{numeric:true});
  });
  return out;
}

function drawXfPanel(ids,items,sel){
  var body=$(ids.body); if(!body) return;
  var shown=items.slice(0,XF_MAX);

  /* Whatever is selected must stay on screen even if its count pushes it
     past the cut, otherwise the highlight and the Clear button disagree. */
  if(sel!==null && !shown.some(function(e){return e.key===sel;})){
    for(var i=0;i<items.length;i++){ if(items[i].key===sel){ shown=[items[i]].concat(shown.slice(0,XF_MAX-1)); break; } }
  }

  var html="";
  shown.forEach(function(e){
    html+='<tr data-key="'+esc(e.key)+'"'+(e.key===sel?' class="on" aria-selected="true"':"")+
          ' role="button" tabindex="0">'+
          '<td class="mono k">'+esc(e.key)+"</td>"+
          '<td class="lbl">'+esc(e.label||"")+"</td>"+
          '<td class="n mono">'+nf.format(e.n)+"</td></tr>";
  });
  body.innerHTML=html||'<tr class="none"><td colspan="3">Nothing to show</td></tr>';

  var n=$(ids.n);
  if(n) n.textContent=items.length>shown.length
    ? nf.format(shown.length)+" of "+nf.format(items.length)
    : nf.format(items.length);

  var clr=$(ids.clr);
  if(clr) clr.hidden=(sel===null);
}

function drawXf(){
  var forVendor = xfUci===null    ? BASE : BASE.filter(function(r){return String(r.UCI||"")===xfUci;});
  var forUci    = xfVendor===null ? BASE : BASE.filter(function(r){return String(r.Vendor||"")===xfVendor;});
  drawXfPanel({body:"#xfVendorBody",n:"#xfVendorN",clr:"#xfVendorClr"},
              countBy(forVendor,"Vendor","VendorNameinSIR"), xfVendor);
  drawXfPanel({body:"#xfUciBody",n:"#xfUciN",clr:"#xfUciClr"},
              countBy(forUci,"UCI",null), xfUci);
}

/* Clicking the already-selected key clears it, matching the grid rows. */
function pickXf(which,key){
  if(which==="vendor") xfVendor=(xfVendor===key?null:key);
  else                 xfUci   =(xfUci===key   ?null:key);
  selected=null; drawDetail(null);
  applyCross();
}

function initXf(){
  if(!$("#sdXf")) return;
  [["vendor","#xfVendorBody","#xfVendorClr"],["uci","#xfUciBody","#xfUciClr"]].forEach(function(p){
    var which=p[0], body=$(p[1]), clr=$(p[2]);
    if(body){
      body.addEventListener("click",function(e){
        var tr=e.target.closest?e.target.closest("tr[data-key]"):null;
        if(tr) pickXf(which,tr.getAttribute("data-key"));
      });
      body.addEventListener("keydown",function(e){
        if(e.key!=="Enter" && e.key!==" ") return;
        var tr=e.target.closest?e.target.closest("tr[data-key]"):null;
        if(tr){ e.preventDefault(); pickXf(which,tr.getAttribute("data-key")); }
      });
    }
    if(clr) clr.addEventListener("click",function(){
      if(which==="vendor") xfVendor=null; else xfUci=null;
      selected=null; drawDetail(null); applyCross();
    });
  });
}

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
    /* Clicking the open record closes it again. */
    var open=function(){
      selected=(selected===r)?null:r;
      drawDetail(selected);
      drawTable();
    };
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

  /* Say how many rows the button will actually write, so nobody assumes it
     exports only the page on screen. */
  var xp=$("#sd_export");
  if(xp){
    xp.disabled=!VIEW.length;
    xp.textContent=VIEW.length
      ? "Export "+nf.format(VIEW.length)+" record"+(VIEW.length===1?"":"s")+" to CSV"
      : "Export to CSV";
  }
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

  html+='<div class="sects">';
  SECTIONS.forEach(function(sec){
    html+='<div class="sect'+(sec.narrative?" wide":"")+'"><h4>'+esc(sec.title)+
          '</h4><div class="body'+(sec.narrative?" narrative":"")+'">';
    sec.fields.forEach(function(col){ html+=fieldHtml(col,r,sec.narrative); });
    html+="</div></div>";
  });
  box.innerHTML=html+"</div>";
}

/* =====================================================================
   TIMELINE PAGE
   Recreates the Power BI timeline page: one lane per individual, the ten
   individuals with the most incidents in the current selection, the x
   axis spanning the selected time window, and one colour-coded dot per
   incident. Dots landing on the same date fan out into a cluster rather
   than hiding one another.

   It reads VIEW, so every sidebar filter and both cross-filter panels
   apply exactly as they do to the grid. Nothing here filters separately.
   ===================================================================== */
var TL = {
  rows: 10,                    // lanes drawn — the "top N" of the page
  colorCol: "IncidentTypes",   // dot colour comes from this column's first token
  dotMax: 14,                  // dots drawn per date before a "+n" chip takes over
  /* Twelve categorical colours, then grey for everything past the top
     twelve incident types. Assigned from ALL rather than VIEW so a colour
     means the same thing no matter how the page is filtered. */
  palette: ["#0f766e","#b45309","#1d4ed8","#b91c1c","#7c3aed","#0891b2",
            "#4d7c0f","#c2410c","#be185d","#4338ca","#0e7490","#a16207"],
  other: "#94a3b8"
};

var VIEWPAGE="details";   // which card page is on screen
var tlColor={};           // incident type -> colour, built once per load

/* The first token of the colour column, which is the type Power BI keys
   the dot colour off when a record carries several. */
function tlKey(r){
  var ts=tokens(r,TL.colorCol);
  return ts.length?ts[0]:"Not recorded";
}

/* Colour lookup, built from ALL and ordered by how often each type
   occurs, so the busiest types get the strong colours and the mapping
   does not shuffle as the user filters. */
function buildTlColors(){
  tlColor={};
  var map={}, keys=[];
  ALL.forEach(function(r){
    var k=tlKey(r);
    if(map[k]===undefined){ map[k]=0; keys.push(k); }
    map[k]++;
  });
  keys.sort(function(a,b){ return (map[b]-map[a]) || a.localeCompare(b); });
  keys.forEach(function(k,i){
    tlColor[k] = i<TL.palette.length ? TL.palette[i] : TL.other;
  });
}

/* The x-axis window. The date boxes win when they are set, because that
   is the window the user chose; otherwise the extent of the rows on
   screen, which is the widest thing worth drawing. */
function tlWindow(rows){
  var f=$("#sd_from").value?parseDate($("#sd_from").value):null;
  var t=$("#sd_to").value?parseDate($("#sd_to").value):null;
  if(!f||!t){
    var lo=null,hi=null;
    rows.forEach(function(r){
      if(!r.__date) return;
      if(!lo||r.__date<lo) lo=r.__date;
      if(!hi||r.__date>hi) hi=r.__date;
    });
    f=f||lo; t=t||hi;
  }
  if(!f||!t) return null;
  if(f>t){ var s=f; f=t; t=s; }
  /* A single-day window has no width to map onto; open it out to a week
     so the lane still reads as a timeline. */
  if(t.getTime()-f.getTime() < 6*DAY_MS) t=new Date(f.getTime()+6*DAY_MS);
  return {a:f.getTime(), b:t.getTime()};
}

/* Position along a lane, as a CSS length. The 13px inset on each side
   keeps a dot sitting on the first or last day of the window from being
   sliced in half by the lane's edge. */
function tlPos(ms,win){
  var p=(ms-win.a)/(win.b-win.a);
  p=Math.max(0,Math.min(1,p));
  return "calc(13px + (100% - 26px) * "+p.toFixed(5)+")";
}

/* Axis ticks, aiming for about eight. Short windows tick in days, the
   rest on whole months so labels land on calendar boundaries. */
function tlTicks(win){
  var out=[], days=Math.round((win.b-win.a)/DAY_MS);
  if(days<=90){
    var step=Math.max(1,Math.ceil(days/8));
    for(var d=0;d<=days;d+=step) out.push(new Date(win.a+d*DAY_MS));
  }else{
    var s=new Date(win.a), e=new Date(win.b);
    var months=(e.getUTCFullYear()-s.getUTCFullYear())*12+(e.getUTCMonth()-s.getUTCMonth());
    var stepM=Math.max(1,Math.ceil((months+1)/8));
    var y=s.getUTCFullYear(), m=s.getUTCMonth();
    if(s.getUTCDate()>1){ m++; if(m>11){m=0;y++;} }
    for(;;){
      var t=Date.UTC(y,m,1);
      if(t>win.b) break;
      out.push(new Date(t));
      m+=stepM; while(m>11){m-=12;y++;}
    }
  }
  return out;
}
function tlTickLabel(d,win){
  var days=Math.round((win.b-win.a)/DAY_MS);
  return days<=90
    ? d.toLocaleDateString("en-US",{month:"short",day:"numeric",timeZone:"UTC"})
    : d.toLocaleDateString("en-US",{month:"short",year:"2-digit",timeZone:"UTC"});
}

function drawTimeline(){
  var host=$("#sdPgTimeline"); if(!host) return;

  /* countBy already counts incidents per UCI the way the cross-filter
     panel does, sorted descending — the top of that list IS the top ten. */
  var lanes=countBy(VIEW,"UCI",null).slice(0,TL.rows);
  var win=tlWindow(VIEW);

  if(!lanes.length || !win){
    host.innerHTML='<div class="tlempty"><strong>Nothing to plot</strong>'+
      'No records with an incident date match this selection.</div>';
    return;
  }

  var byUci={}, used={};
  lanes.forEach(function(l){ byUci[l.key]=[]; });
  VIEW.forEach(function(r){
    var k=String(r.UCI||"");
    if(!byUci[k] || !r.__date) return;
    byUci[k].push(r);
    used[tlKey(r)]=1;
  });

  var ticks=tlTicks(win);
  var gridHtml="";
  ticks.forEach(function(t){
    gridHtml+='<i class="tlgl" style="left:'+tlPos(t.getTime(),win)+'"></i>';
  });

  var html='<div class="tlhd">'+
    '<h3>Top '+lanes.length+' individual'+(lanes.length===1?"":"s")+' by incident count</h3>'+
    '<span class="tlwin mono">'+esc(fmtDate(new Date(win.a)))+'  to  '+esc(fmtDate(new Date(win.b)))+'</span>'+
    '</div>';
  /* What the page means is explained in the card header, beside the tabs,
     where sir_editor.html can still reach the wording. */

  /* Legend: only the types actually on screen, in palette order, so the
     strongest colours read first. */
  var legend=Object.keys(used).sort(function(a,b){
    var ia=TL.palette.indexOf(tlColor[a]||TL.other), ib=TL.palette.indexOf(tlColor[b]||TL.other);
    if(ia<0) ia=99;
    if(ib<0) ib=99;
    return (ia-ib) || a.localeCompare(b);
  });
  html+='<div class="tllegend">';
  legend.forEach(function(k){
    html+='<span class="tlkey"><i style="background:'+(tlColor[k]||TL.other)+'"></i>'+esc(k)+'</span>';
  });
  html+='</div>';

  html+='<div class="tllanes">';
  lanes.forEach(function(l){
    var rows=byUci[l.key]||[];

    /* One cluster per date. Ordering a cluster by type keeps the same
       colour together when a date carries several records. */
    var byDay={}, dayKeys=[];
    rows.forEach(function(r){
      var k=isoDate(r.__date);
      if(!byDay[k]){ byDay[k]=[]; dayKeys.push(k); }
      byDay[k].push(r);
    });

    var dots="";
    dayKeys.forEach(function(dk){
      var g=byDay[dk].slice().sort(function(a,b){return tlKey(a).localeCompare(tlKey(b));});
      var k=g.length, shown=Math.min(k,TL.dotMax);
      /* Tighter spacing as a cluster grows: that is what makes a busy date
         read as one dense smear instead of running into its neighbours. */
      var gap = k<=3 ? 10 : (k<=6 ? 7 : (k<=10 ? 5 : 4));
      var left=tlPos(parseDate(dk).getTime(),win);
      for(var i=0;i<shown;i++){
        var r=g[i], key=tlKey(r);
        var off=(i-(shown-1)/2)*gap;
        var tip=fmtDate(r.__date)+"  ·  "+key+
                (r.IncidentNumber?"  ·  Incident "+r.IncidentNumber:"")+
                (k>1?"  ("+(i+1)+" of "+k+" on this date)":"");
        dots+='<button type="button" class="tldot" data-uci="'+esc(l.key)+'" data-i="'+esc(dk)+'" data-n="'+i+'"'+
              ' style="left:'+left+';margin-left:'+off.toFixed(1)+'px;background:'+(tlColor[key]||TL.other)+'"'+
              ' title="'+esc(tip)+'"><span class="sr">'+esc(tip)+'</span></button>';
      }
      if(k>shown){
        dots+='<span class="tlmore" style="left:'+left+';margin-left:'+
              ((shown-1)/2*gap+9).toFixed(1)+'px" title="'+
              esc(fmtDate(parseDate(dk))+": "+k+" incidents on this date")+'">+'+(k-shown)+'</span>';
      }
    });

    html+='<div class="tlrow'+(xfUci===l.key?" on":"")+'">'+
      '<button type="button" class="tllab" data-uci="'+esc(l.key)+'"'+
        ' title="Filter the dashboard to UCI '+esc(l.key)+'">'+
        '<span class="u mono">'+esc(l.key)+'</span>'+
        '<span class="n mono">'+nf.format(l.n)+'</span></button>'+
      '<div class="tlplot">'+gridHtml+'<i class="tlbase"></i>'+dots+'</div></div>';
  });

  /* Axis last, so it sits directly under the lowest lane. */
  var axis="";
  ticks.forEach(function(t){
    axis+='<span class="tlt" style="left:'+tlPos(t.getTime(),win)+'">'+esc(tlTickLabel(t,win))+'</span>';
  });
  html+='<div class="tlrow tlaxisrow"><div class="tllabspacer"></div>'+
        '<div class="tlplot tlaxis">'+gridHtml+axis+'</div></div>';
  html+='</div>';

  var tot=0; lanes.forEach(function(l){tot+=l.n;});
  html+='<p class="tlfoot">These '+lanes.length+' individual'+(lanes.length===1?"":"s")+' account for '+
        nf.format(tot)+' of the '+nf.format(VIEW.length)+' incident'+(VIEW.length===1?"":"s")+
        ' in the current selection.</p>';

  host.innerHTML=html;
}

/* A dot click hands the record to the Details page, and takes the grid to
   whichever page of VIEW that record sits on — otherwise the detail panel
   would open on a record the grid is not showing. */
function tlOpenRecord(uci,iso,n){
  var hits=VIEW.filter(function(r){
    return String(r.UCI||"")===uci && r.__date && isoDate(r.__date)===iso;
  }).sort(function(a,b){return tlKey(a).localeCompare(tlKey(b));});
  var r=hits[+n]||hits[0];
  if(!r) return;
  var idx=VIEW.indexOf(r);
  if(idx>=0) page=Math.floor(idx/pageSize)+1;
  selected=r;
  setViewPage("details");
  drawDetail(r);
  drawTable();
  var box=$("#sdDetail");
  if(box && box.scrollIntoView) box.scrollIntoView({block:"nearest"});
}

/* Switching pages swaps which half of the card is hidden and relabels the
   card header, since the heading and the note describe the page, not the
   dashboard. */
function setViewPage(v){
  VIEWPAGE=(v==="timeline")?"timeline":"details";
  var d=$("#sdPgDetails"), t=$("#sdPgTimeline");
  if(d) d.hidden=(VIEWPAGE!=="details");
  if(t) t.hidden=(VIEWPAGE!=="timeline");
  $$("#sdTabs .tab").forEach(function(b){
    var on=b.getAttribute("data-view")===VIEWPAGE;
    b.classList.toggle("on",on);
    b.setAttribute("aria-selected",on?"true":"false");
  });
  /* The two headings and the two notes are real markup, toggled rather
     than rewritten, so their wording stays editable in sir_editor.html. */
  [["#sdH1Details","#sdH1Timeline"],["#sdNoteDetails","#sdNoteTimeline"]].forEach(function(p){
    var d=$(p[0]), t=$(p[1]);
    if(d) d.hidden=(VIEWPAGE!=="details");
    if(t) t.hidden=(VIEWPAGE!=="timeline");
  });
  if(VIEWPAGE==="timeline") drawTimeline();
}

function initTimeline(){
  var tabs=$("#sdTabs");
  if(tabs) tabs.addEventListener("click",function(e){
    var b=e.target.closest?e.target.closest(".tab[data-view]"):null;
    if(b) setViewPage(b.getAttribute("data-view"));
  });
  var host=$("#sdPgTimeline");
  if(host) host.addEventListener("click",function(e){
    var lab=e.target.closest?e.target.closest(".tllab[data-uci]"):null;
    if(lab){ pickXf("uci",lab.getAttribute("data-uci")); return; }
    var dot=e.target.closest?e.target.closest(".tldot"):null;
    if(dot) tlOpenRecord(dot.getAttribute("data-uci"),dot.getAttribute("data-i"),dot.getAttribute("data-n"));
  });
  buildTlColors();
}

/* ---------------------- CSV export ----------------------
   Exports VIEW — everything the current filters select, not just the page
   on screen — with every SCHEMA column, not just the eleven in the grid.

   Excel will not read a bare UTF-8 file correctly; it needs the byte-order
   mark, or names and diagnoses with accents arrive mangled. The .csv then
   opens straight into Excel on a double-click.

   Note this writes HIPAA-sensitive records to the user's own machine, where
   none of the protections around this page apply any more.
   -------------------------------------------------------- */

function csvCell(v){
  var s=(v==null?"":String(v));
  /* Quote everything: the narrative fields carry commas, quotes and real
     newlines, and half-quoting is how CSV exports break. */
  return '"'+s.replace(/"/g,'""')+'"';
}

function csvRows(rows){
  var cols=SCHEMA.map(function(f){return f.c;});
  var out=[cols.map(function(c){return csvCell(labelOf(c));}).join(",")];
  rows.forEach(function(r){
    out.push(cols.map(function(c){
      /* Send the date in ISO so Excel and Stata both parse it, rather than
         the "Sep 30, 2025" the grid shows. */
      if(META[c]&&META[c].date && r.__date) return csvCell(isoDate(r.__date));
      return csvCell(r[c]);
    }).join(","));
  });
  return out.join("\r\n");
}

/* Name the file after what is actually IN it, not after the scope — the
   sidebar can narrow to one RC inside an all-RC scope, and a file full of
   ACRC records called "AllRC" is a filing error waiting to happen. */
function exportName(){
  var bits=["SIR_details"], rcs={}, n=0;
  VIEW.forEach(function(r){ if(!isBlank(r.RC) && !rcs[r.RC]){ rcs[r.RC]=1; n++; } });
  bits.push(n===1 ? Object.keys(rcs)[0] : (n===0 ? "noRC" : n+"RCs"));
  var ds=VIEW.map(function(r){return r.__date;}).filter(Boolean).sort(function(a,b){return a-b;});
  if(ds.length) bits.push(isoDate(ds[0])+"_to_"+isoDate(ds[ds.length-1]));
  return bits.join("_")+".csv";
}

function exportCsv(){
  if(!VIEW.length) return;
  /* U+FEFF is the byte-order mark, built from its code point so no editor or
     encoding step can silently eat an invisible character. Excel needs it to
     read the file as UTF-8; without it, accented names arrive mangled. */
  var BOM=String.fromCharCode(0xFEFF);
  var blob=new Blob([BOM+csvRows(VIEW)],{type:"text/csv;charset=utf-8;"});
  var url=URL.createObjectURL(blob);
  var a=document.createElement("a");
  a.href=url; a.download=exportName();
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  /* Revoking immediately can cancel the download in some browsers. */
  setTimeout(function(){ URL.revokeObjectURL(url); },1000);
}

/* ---------------------- per-filter clear buttons ----------------------
   Built here rather than in the header HTML so the two header variants
   stay in step and a new .fgroup picks one up for free. A button only
   appears while its control actually holds a value. */

function clearGroup(g){
  g.__ctrls.forEach(function(c){
    if(c.type==="checkbox") c.checked=false; else c.value="";
  });
  if(dslSide) dslSide.sync();
  selected=null; drawDetail(null); applyFilters();
}

function addClear(g,ctrls,host){
  if(!ctrls.length) return;
  var b=document.createElement("button");
  b.type="button"; b.className="clr"; b.innerHTML="&times;";
  b.title="Clear this filter";
  b.setAttribute("aria-label","Clear this filter");
  b.addEventListener("click",function(e){ e.preventDefault(); clearGroup(g); });
  g.__ctrls=ctrls; g.__clr=b;
  (host||g).appendChild(b);
}

function clearables(){
  return $$("#sdFilters .fgroup").concat($$("#sdFilters fieldset.flags"));
}

function initClears(){
  $$("#sdFilters .fgroup").forEach(function(g){
    addClear(g,$$_in(g,"select,input"));
  });
  var fs=$("#sdFilters fieldset.flags");
  if(fs) addClear(fs,$$_in(fs,"input[type=checkbox]"),fs.querySelector("legend"));
  syncClears();
}

/* The date-range group also contains the slider's two range inputs. They
   mirror the date boxes rather than holding a value of their own, so they
   must not count towards "this filter is set". */
function $$_in(el,sel){
  return Array.prototype.slice.call(el.querySelectorAll(sel)).filter(function(c){
    return !c.closest || !c.closest(".dslhost");
  });
}

function groupHasValue(g){
  return g.__ctrls.some(function(c){
    return c.type==="checkbox" ? c.checked : String(c.value||"")!=="";
  });
}

function syncClears(){
  clearables().forEach(function(g){
    if(g.__clr) g.__clr.hidden=!groupHasValue(g);
  });
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
    $(id).addEventListener("change",function(){
      if(dslSide) dslSide.sync();
      selected=null; drawDetail(null); applyFilters();
    });
  });
  $("#sd_pagesize").addEventListener("change",function(){ pageSize=+this.value||100; page=1; drawTable(); });
  $("#sd_prev").addEventListener("click",function(){ if(page>1){page--;drawTable();} });
  $("#sd_next").addEventListener("click",function(){ page++;drawTable(); });
  $("#sd_reset").addEventListener("click",function(){
    selects().forEach(function(s){s.value="";});
    checks().forEach(function(c){c.checked=false;});
    $("#sd_uci").value=""; $("#sd_vendor").value="";
    $("#sd_from").value=""; $("#sd_to").value="";
    xfVendor=null; xfUci=null;
    if(dslSide) dslSide.sync();
    selected=null; drawDetail(null); applyFilters();
  });

  var xp=$("#sd_export");
  if(xp) xp.addEventListener("click",exportCsv);

  initClears();
  initXf();
  initTimeline();

  var ds=ALL.map(function(r){return r.__date;}).filter(Boolean).sort(function(a,b){return a-b;});
  if(ds.length){
    var lo=isoDate(ds[0]), hi=isoDate(ds[ds.length-1]);
    $("#sd_from").min=$("#sd_to").min=lo;
    $("#sd_from").max=$("#sd_to").max=hi;
    $("#sdThrough").textContent=fmtDate(ds[ds.length-1]);
    /* The sidebar slider spans the dates actually loaded — dragging it can
       only ever narrow what is already in the browser. */
    dslSide=makeDateSlider($("#sd_dsl"),{
      min:lo, max:hi, fromEl:$("#sd_from"), toEl:$("#sd_to"),
      onCommit:function(){ selected=null; drawDetail(null); applyFilters(); }
    });
  }else{
    var h=$("#sd_dsl"); if(h) h.hidden=true;
  }
}

/* A row count sitting exactly on the DataPage's record cap means Caspio
   stopped sending, not that the data ran out. Everything downstream — the
   tiles, both cross-filter panels, the date range — then describes a
   truncated slice, so warn before any of it is read as a total. */
function drawLoadWarn(n){
  var el=ROOT.querySelector("#sdLoadWarn");
  if(!el) return;
  if(n!==LOAD_CAP){ el.hidden=true; el.textContent=""; return; }
  el.hidden=false;
  el.innerHTML="<strong>Incomplete load — "+nf.format(LOAD_CAP)+" records is this DataPage's limit.</strong>"+
    "Caspio stopped at the cap, so more records match this scope than are shown. "+
    "Counts, totals and the cross-filter panels below are all undercounts. "+
    "Narrow the Regional Center or the incident date range above and load again.";
}

function start(rawRows){
  ALL=(rawRows||[]).map(normalize);
  initControls();
  applyFilters();
  drawDetail(null);
  drawScopeLine(ALL.length);
  drawLoadWarn(ALL.length);
}

/* =====================================================================
   ============================== SCOPE ================================
   The bar under the header does not filter anything itself — it rewrites
   the page URL and reloads, so Caspio re-runs its query and sends back a
   different slice. Regional Center and the incident-date window are the
   two server-side parameters: they decide WHICH records cross the wire.
   Every other filter lives in the sidebar and works on the rows already
   loaded, so it costs nothing and needs no reload.

   All three are optional. An empty box is dropped from the URL rather than
   sent blank, which is what Caspio needs to fall through to "match all".

   Caspio Date/Time criteria expect MM/DD/YYYY on the URL; <input type=date>
   speaks YYYY-MM-DD. isoToUs/usToIso translate between the two.
   ===================================================================== */

function pad2(n){ return (n<10?"0":"")+n; }

function isoToUs(s){
  var m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s||"").trim());
  return m ? m[2]+"/"+m[3]+"/"+m[1] : "";
}
function usToIso(s){
  var v=String(s||"").trim();
  var m=/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if(m) return m[3]+"-"+pad2(+m[1])+"-"+pad2(+m[2]);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "";
}

function urlParams(){
  var out={}, q=location.search.replace(/^\?/,"");
  if(!q) return out;
  q.split("&").forEach(function(pair){
    if(!pair) return;
    var i=pair.indexOf("=");
    var k=i<0?pair:pair.slice(0,i), v=i<0?"":pair.slice(i+1);
    try{ out[decodeURIComponent(k)]=decodeURIComponent(v.replace(/\+/g," ")); }catch(e){}
  });
  return out;
}

/* What the URL asks for. Any of the three may be blank = no narrowing. */
function currentScope(){
  var p=urlParams();
  return {
    rc  : (p[SCOPE.param.rc]||"").trim(),
    from: usToIso(p[SCOPE.param.from]),
    to  : usToIso(p[SCOPE.param.to])
  };
}

/* Keep any unrelated parameters already on the URL. An empty RC is dropped
   rather than sent blank, so Caspio's criterion matches every RC. */
function scopeUrl(sc){
  var p=urlParams();
  p[SCOPE.param.rc]   = sc.rc||"";
  p[SCOPE.param.from] = isoToUs(sc.from);
  p[SCOPE.param.to]   = isoToUs(sc.to);
  p.sdscope="1";
  var parts=[];
  for(var k in p){
    if(!Object.prototype.hasOwnProperty.call(p,k) || p[k]==="") continue;
    parts.push(encodeURIComponent(k)+"="+encodeURIComponent(p[k]));
  }
  return location.pathname+(parts.length?"?"+parts.join("&"):"")+location.hash;
}

function drawScopeLine(n){
  var el=ROOT.querySelector("#sdScopeNow");
  if(!el) return;
  var sc=currentScope();
  var bits=[sc.rc||"All Regional Centers"];
  if(sc.from && sc.to)   bits.push(isoToUs(sc.from)+" - "+isoToUs(sc.to));
  else if(sc.from)       bits.push("on or after "+isoToUs(sc.from));
  else if(sc.to)         bits.push("on or before "+isoToUs(sc.to));
  else                   bits.push("all dates");
  bits.push(n==null ? "loading…"
                    : n.toLocaleString()+" record"+(n===1?"":"s")+" loaded");
  el.textContent="Showing  "+bits.join("   ·   ");
}

/* Wires the Regional Center picker and the date window. Returns false - it
   never navigates on its own; only the "Load records" button does. */
function initScope(){
  if(!ROOT.querySelector("#sdScope")) return false;
  var sc=currentScope();
  var sel=ROOT.querySelector("#sc_rc");
  var opts=[SCOPE.allRc
    ? '<option value="">All Regional Centers</option>'
    : '<option value="">Choose a Regional Center…</option>'];
  SCOPE.rcs.forEach(function(rc){
    opts.push('<option value="'+rc+'"'+(rc===sc.rc?" selected":"")+">"+rc+"</option>");
  });
  sel.innerHTML=opts.join("");

  var fromEl=ROOT.querySelector("#sc_from"), toEl=ROOT.querySelector("#sc_to");
  if(fromEl) fromEl.value=sc.from;
  if(toEl)   toEl.value=sc.to;

  /* The scope slider's domain comes from SCOPE, not from the data: it has
     to be able to ask for dates the current slice does not contain. */
  if(fromEl && toEl){
    var hi=SCOPE.maxDate || isoDate(new Date());
    fromEl.min=toEl.min=SCOPE.minDate; fromEl.max=toEl.max=hi;
    dslScope=makeDateSlider(ROOT.querySelector("#sc_dsl"),
      {min:SCOPE.minDate, max:hi, fromEl:fromEl, toEl:toEl});
    [fromEl,toEl].forEach(function(el){
      el.addEventListener("change",function(){ if(dslScope) dslScope.sync(); });
    });
  }

  ROOT.querySelector("#sc_load").addEventListener("click",function(){
    var msg=ROOT.querySelector("#sdScopeMsg");
    var from=fromEl?fromEl.value:"", to=toEl?toEl.value:"";
    if(!SCOPE.allRc && !sel.value){ msg.textContent="Choose a Regional Center."; return; }
    if(from && to && from>to){ msg.textContent="The From date is after the To date."; return; }
    msg.textContent="";
    location.assign(scopeUrl({rc:sel.value, from:from, to:to}));
  });

  /* Enter anywhere in the scope bar loads, same as the button. */
  ROOT.querySelector("#sdScope").addEventListener("keydown",function(e){
    if(e.keyCode===13){ e.preventDefault(); ROOT.querySelector("#sc_load").click(); }
  });

  drawScopeLine(null);
  return false;
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

/* Caspio still lays out its own results — one row per record, every field
   removed, so they render as blank strips under the dashboard, plus the
   pager beneath them. The stylesheet hides the classes Caspio uses TODAY,
   but those names change between account versions, so do it structurally
   as well: climb from a record block to the highest ancestor that does not
   contain our own UI, and hide that. Rows are read before this runs, and
   textContent keeps working inside a display:none subtree anyway. */
function hideCaspioResults(){
  var blocks=document.querySelectorAll("[data-sir-rec]");
  for(var i=0;i<blocks.length;i++){
    var el=blocks[i], top=null;
    while(el.parentNode && el.parentNode.nodeType===1 && el.parentNode!==document.body){
      el=el.parentNode;
      if(ROOT && el.contains(ROOT)) break;   /* any higher would hide us too */
      top=el;
    }
    if(top && top.style) top.style.display="none";
  }
}

/* Caspio results may be injected asynchronously, so poll briefly. */
function loadEmbedded(){
  var tries=0, limit=Math.ceil(WAIT_MS/100), timer=null;
  function tick(){
    var rows=readEmbeddedRows();
    if(rows.length){
      clearInterval(timer);
      if(window.console) console.log("SIR details: read "+rows.length+" record block(s).");
      PERF.blocks=nowMs(); PERF.rows=rows.length;
      hideCaspioResults();
      start(rows);
      PERF.done=nowMs(); reportPerf();
    }else if(++tries>limit){
      clearInterval(timer);
      if(window.console) console.warn("SIR details: no [data-sir-rec] blocks after "+Math.round(WAIT_MS/1000)+"s — either the DataPage returned no rows for these parameters, or the per-record HTML Block is missing from Configure Results Page Fields.");
      var em=ROOT.querySelector("#sdEmpty");
      if(em) em.innerHTML="<strong>No records arrived from Caspio</strong>Either the query returned nothing for this scope, or the per-record HTML Block is not on the results page. See the browser console.";
      start([]);
    }
  }
  tick();
  if(!PERF.done) timer=setInterval(tick,100);
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
    if(initScope()) return;          // navigated to the default scope
    if(DATA_MODE==="caspio-html") loadEmbedded();
    else if(DATA_MODE==="caspio-rest") loadRest();
    else start(buildDemo());
  }catch(err){
    if(window.console) console.error("SIR details init failed:",err);
  }
}
/* =====================================================================
   Caspio does not guarantee that #sir-details is in the DOM when this
   file executes: the standard embed writes the DataPage in place, but the
   Preview window and some deployments inject it afterwards. Wait for the
   container rather than silently doing nothing.
   ===================================================================== */
function whenRoot(){
  ROOT = document.getElementById("sir-details");
  if(ROOT){ boot(); return; }
  var tries = 0;
  var timer = setInterval(function(){
    ROOT = document.getElementById("sir-details");
    if(ROOT){ clearInterval(timer); boot(); }
    else if(++tries > 100){
      clearInterval(timer);
      if(window.console) console.warn("SIR details: #sir-details never appeared after 10s — the header HTML is not on this DataPage, or something stripped it.");
    }
  },100);
}
whenRoot();

})();
