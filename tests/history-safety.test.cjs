const assert=require("node:assert/strict");
const {test,before,after}=require("node:test");
const {readFile,mkdir}=require("node:fs/promises");
const {createServer}=require("node:http");
const path=require("node:path");
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||"playwright");

const root=path.join(__dirname,"..");
const key="aiExamHistoryV01";
const payload='<img src=x onerror="window.historyXss=true"><svg onload="window.historyXss=true"></svg>&"\'';
let server,browser,origin,bank;
const clone=x=>JSON.parse(JSON.stringify(x));
function legacy(overrides={}){
  return {date:"2026-07-17T08:00:00.000Z",exam:"ipas_s1",count:2,correct:1,score:50,elapsed:95,...overrides};
}
function detailed(overrides={}){
  const questions=bank.filter(q=>q.exam==="ipas_s1").slice(0,2).map(clone);
  return legacy({version:"0.3",questionVersion:"0.3",isRetry:false,details:questions.map((q,i)=>({q,user:i===0?q.answer:null,ok:i===0})),...overrides});
}
async function open(t,raw){
  const context=await browser.newContext({acceptDownloads:true});
  t.after(()=>context.close());
  const page=await context.newPage();
  const errors=[],dialogs=[];
  page.on("pageerror",error=>errors.push(error.message));
  page.on("dialog",async dialog=>{dialogs.push(dialog.message());await dialog.accept()});
  await page.goto(origin);
  if(raw!==undefined)await page.evaluate(({key,raw})=>localStorage.setItem(key,raw),{key,raw});
  t.after(()=>assert.deepEqual(errors,[],"no uncaught browser errors"));
  return {page,dialogs};
}
const stored=page=>page.evaluate(key=>localStorage.getItem(key),key);
async function show(page){await page.locator("#historyBtn").click()}
async function download(page){
  const pending=page.waitForEvent("download");
  await page.locator("#exportHistory").click();
  const file=await pending;
  assert.match(file.suggestedFilename(),/^AI模擬考歷史紀錄_.*\.json$/);
  return readFile(await file.path(),"utf8");
}
async function submitNew(page){
  await page.evaluate(()=>{goHome();document.querySelector("#useTimer").checked=false;startQuiz();submitQuiz(true)});
  assert.equal(await page.locator("#results").isVisible(),true);
}
async function screenshot(page,name){
  if(process.env.HISTORY_SCREENSHOT_DIR){
    await mkdir(process.env.HISTORY_SCREENSHOT_DIR,{recursive:true});
    await page.screenshot({path:path.join(process.env.HISTORY_SCREENSHOT_DIR,name+".png"),fullPage:true});
  }
}
before(async()=>{
  bank=JSON.parse(await readFile(path.join(root,"question_bank_v0_3.json"),"utf8"));
  if(!Array.isArray(bank))bank=bank.questions;
  server=createServer(async(req,res)=>{
    const file=new URL(req.url,"http://localhost").pathname.slice(1)||"index.html";
    if(!["index.html","app.js","questions.js","styles.css"].includes(file)){res.writeHead(404);res.end();return}
    try{
      const content=await readFile(path.join(root,file));
      res.setHeader("Content-Type",file.endsWith(".js")?"text/javascript":file.endsWith(".css")?"text/css":"text/html");
      res.end(content);
    }catch{res.writeHead(500);res.end()}
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  origin=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({headless:true});
});
after(async()=>{if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve))});

test("empty storage remains untouched and exports an empty array",async t=>{
  const {page}=await open(t);
  await show(page);
  assert.match(await page.locator("#history").textContent(),/目前沒有作答紀錄/);
  assert.deepEqual(JSON.parse(await download(page)),[]);
  assert.equal(await stored(page),null);
});

test("V0.1, V0.2 and V0.3 scores, details, statistics and export remain usable",async t=>{
  const v02=detailed({version:"0.2"});delete v02.isRetry;
  v02.details.forEach(row=>delete row.q.level);
  const entries=[legacy(),v02,detailed({isRetry:true})];
  const raw=JSON.stringify(entries);
  const {page}=await open(t,raw);
  await show(page);
  assert.equal(await page.locator("tbody tr").count(),3);
  assert.equal(await page.locator(".history-detail").count(),2);
  assert.match(await page.locator("tbody tr").first().textContent(),/一般測驗.*2.*50.*1 分 35 秒.*舊紀錄無明細/s);
  assert.deepEqual(JSON.parse(await download(page)),entries);
  await screenshot(page,"normal-history");
  await page.locator(".history-detail").first().click();
  assert.equal(await page.locator(".review-card").count(),2);
  assert.match(await page.locator(".breakdown").textContent(),/1／1（100%）.*0／1（0%）/s);
  await page.locator("#historyOnlyWrong").click();
  assert.equal(await page.locator('.review-card:not(.hidden)').count(),1);
  await page.locator("#historyShowAll").click();
  assert.equal(await page.locator('.review-card:not(.hidden)').count(),2);
  await page.locator("#historyListBack").click();
  assert.equal(await stored(page),raw);
});

test("historical retry retains the exam, timer, options, scoring and retry flag",async t=>{
  const item=detailed();
  const {page}=await open(t,JSON.stringify([item]));
  await show(page);
  await page.locator(".history-detail").click();
  await page.locator("#historyRetryWrong").click();
  assert.equal(await page.locator("#quiz").isVisible(),true);
  assert.equal(await page.locator("#timer").textContent(),"01:30");
  assert.equal(await page.locator("#qText").textContent(),item.details[1].q.question);
  await page.evaluate(()=>{session.answers[0]=session.questions[0].answer;submitQuiz(true)});
  const entries=JSON.parse(await stored(page));
  assert.equal(entries.length,2);
  assert.equal(entries[0].isRetry,true);
  assert.equal(entries[0].score,100);
  assert.deepEqual(entries[1],item);
  await page.evaluate(()=>{goHome();showHistory()});
  await page.locator(".history-detail").first().click();
  assert.equal(await page.locator("#historyRetryWrong").isDisabled(),true);
});

test("corrupt JSON and non-array roots display safely, preserve bytes, export and do not overwrite on submission",async t=>{
  for(const raw of ["{broken", "", "null", "{}", '"text"', "7", "true"]){
    await t.test(JSON.stringify(raw),async t=>{
      const {page,dialogs}=await open(t,raw);
      await show(page);
      assert.match(await page.locator('[role="status"]').textContent(),/原始資料未刪除/);
      const exported=await download(page);
      let parsed;
      try{parsed=JSON.parse(raw)}catch(error){}
      if(parsed===undefined)assert.equal(exported,raw);
      else assert.deepEqual(JSON.parse(exported),parsed);
      assert.equal(await stored(page),raw);
      await screenshot(page,"damaged-history");
      await submitNew(page);
      assert.equal(await stored(page),raw);
      assert.ok(dialogs.some(message=>message.includes("本次成績未儲存")));
    });
  }
});

test("invalid summary shapes, payloads and numeric types are skipped without hiding adjacent valid scores",async t=>{
  const invalid=[null,[],true,7,payload,{},legacy({exam:"__proto__"}),legacy({exam:"constructor"}),legacy({exam:"toString"}),legacy({date:"not a date"}),legacy({count:0}),legacy({correct:3}),legacy({score:101}),legacy({score:51}),legacy({elapsed:-1}),legacy({count:2.5}),legacy({elapsed:1e100})];
  for(const field of ["date","exam","count","correct","score","elapsed","isRetry"]){
    for(const value of [payload,{},[],null,true]){
      if(field!=="isRetry"||value!==true)invalid.push(legacy({[field]:value}));
    }
  }
  for(const field of ["count","correct","score","elapsed"]){
    invalid.push(legacy({[field]:String(legacy()[field])}));
  }
  const entries=[...invalid,legacy(),detailed()];
  const raw=JSON.stringify(entries);
  const {page}=await open(t,raw);
  await show(page);
  assert.equal(await page.locator("tbody tr").count(),2);
  assert.equal(await page.locator("#history img, #history svg, #history script").count(),0);
  assert.equal(await page.evaluate(()=>window.historyXss),undefined);
  assert.deepEqual(JSON.parse(await download(page)),entries);
  await page.locator(".history-detail").click();
  assert.equal(await page.locator(".review-card").count(),2,"filtered row index opens the correct detail");
  assert.equal(await stored(page),raw);
});

test("malformed detail rows keep valid summaries and cannot enable statistics or retry",async t=>{
  const changes=[
    x=>{x.details=null},x=>{x.details={}},x=>{x.details=[]},x=>{x.details=[null,null]},
    x=>{x.details[0].q=null},x=>{x.details[0].q=[]},x=>{x.details[0].q.exam="iii"},
    x=>{x.details[0].q.category={}},x=>{x.details[0].q.question=[]},x=>{x.details[0].q.explanation=null},
    x=>{x.details[0].q.level={}},x=>{x.details[0].q.options={}},x=>{x.details[0].q.options=[]},
    x=>{x.details[0].q.options[0]={}},x=>{x.details[0].q.options=Array(27).fill("option")},
    x=>{x.details[0].q.answer=-1},x=>{x.details[0].q.answer="0"},x=>{x.details[0].q.answer=4},
    x=>{x.details[0].q.difficulty=1000000000},x=>{x.details[0].q.difficulty="1"},
    x=>{x.details[0].user=4},x=>{x.details[0].user="0"},x=>{x.details[0].user={}},
    x=>{x.details[0].ok="false"},x=>{x.details[0].ok=false},
    x=>{x.details[1].ok=true;x.details[1].user=x.details[1].q.answer}
  ];
  const entries=changes.map(change=>{const item=detailed();change(item);return item});
  const raw=JSON.stringify(entries);
  const {page,dialogs}=await open(t,raw);
  await show(page);
  assert.equal(await page.locator("tbody tr").count(),entries.length);
  assert.equal(await page.locator(".history-detail").count(),0);
  assert.match(await page.locator("tbody").textContent(),/明細損壞，僅顯示成績/);
  await page.evaluate(()=>showHistoryDetail(0));
  assert.ok(dialogs.some(message=>message.includes("沒有保存逐題明細")));
  assert.equal(await stored(page),raw);
});

test("HTML in every detail text field renders literally in review and retry",async t=>{
  const item=detailed();
  for(const row of item.details){
    for(const field of ["category","question","explanation","level"])row.q[field]=payload;
    row.q.options=row.q.options.map(()=>payload);
  }
  const raw=JSON.stringify([item]);
  const {page}=await open(t,raw);
  await show(page);await page.locator(".history-detail").click();
  assert.ok((await page.locator("#history").textContent()).includes(payload));
  assert.equal(await page.locator("#history img, #history svg, #history script").count(),0);
  assert.equal(await page.evaluate(()=>window.historyXss),undefined);
  await screenshot(page,"escaped-history-detail");
  await page.locator("#historyRetryWrong").click();
  assert.equal(await page.locator("#qText").textContent(),payload);
  assert.equal(await page.locator("#options img, #options svg, #options script").count(),0);
  await page.evaluate(()=>goHome());
  assert.equal(await stored(page),raw);
});

test("prototype-like category names have isolated, correct statistics",async t=>{
  const {page}=await open(t);
  for(const category of ["__proto__","constructor","toString"]){
    const item=detailed();item.details.forEach(row=>{row.q.category=category});
    await page.evaluate(({key,item})=>{localStorage.setItem(key,JSON.stringify([item]));showHistory()},{key,item});
    await page.locator(".history-detail").click();
    assert.equal((await page.locator(".break-item").textContent()).trim(),`${category}1／2（50%）`);
    assert.equal(await page.evaluate(()=>Object.prototype.total),undefined);
  }
});

test("new submissions preserve raw array entries, including malformed records, within the existing limit",async t=>{
  const entries=[legacy(),null,{bad:payload},detailed()];
  const {page}=await open(t,JSON.stringify(entries));
  await submitNew(page);
  const saved=JSON.parse(await stored(page));
  assert.equal(saved.length,5);assert.deepEqual(saved.slice(1),entries);
  assert.equal(saved[0].details.length,20);
  await page.evaluate(()=>{goHome();showHistory()});
  assert.equal(await page.locator("tbody tr").count(),3);
});

test("normal history retains the existing most-recent-20 policy",async t=>{
  const entries=Array.from({length:30},(_,i)=>legacy({elapsed:i}));
  const {page}=await open(t,JSON.stringify(entries));
  await submitNew(page);
  const saved=JSON.parse(await stored(page));
  assert.equal(saved.length,20);assert.deepEqual(saved.slice(1),entries.slice(0,19));
});

test("all three exams save valid detailed scores and export without data loss",async t=>{
  const {page}=await open(t);
  for(const exam of ["ipas_s1","ipas_s2","iii"]){
    await page.evaluate(exam=>{goHome();selectedExam=exam;document.querySelector("#useTimer").checked=false;renderCategories();startQuiz();session.answers=session.questions.map(q=>q.answer);submitQuiz(true)},exam);
    assert.equal(await page.locator("#results .score").textContent(),"100");
  }
  const raw=await stored(page);
  await page.evaluate(()=>{goHome();showHistory()});
  assert.equal(await page.locator(".history-detail").count(),3);
  assert.deepEqual(JSON.parse(await download(page)),JSON.parse(raw));
});

test("storage read/write failures do not crash results, history or export",async t=>{
  const {page,dialogs}=await open(t);
  await page.evaluate(()=>{Storage.prototype.getItem=function(){throw new DOMException("blocked","SecurityError")}});
  await show(page);await page.locator("#exportHistory").click();await submitNew(page);
  assert.ok(dialogs.some(message=>message.includes("未匯出紀錄")));
  await page.reload();
  await page.evaluate(()=>{Storage.prototype.setItem=function(){throw new DOMException("full","QuotaExceededError")}});
  await submitNew(page);
  assert.ok(dialogs.some(message=>message.includes("儲存空間不足")));
});

test("quota fallback still retains the newest five records",async t=>{
  const {page}=await open(t,JSON.stringify(Array.from({length:10},()=>legacy())));
  await page.evaluate(()=>{
    const set=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value){if(JSON.parse(value).length>5)throw new DOMException("full","QuotaExceededError");return set.call(this,key,value)};
  });
  await submitNew(page);
  assert.equal(JSON.parse(await stored(page)).length,5);
});

test("explicit clear still requires confirmation, cancellation preserves data",async t=>{
  const raw=JSON.stringify([legacy()]);
  const {page}=await open(t,raw);
  await show(page);
  page.removeAllListeners("dialog");page.once("dialog",dialog=>dialog.dismiss());
  await page.locator("#clearHistory").click();assert.equal(await stored(page),raw);
  page.once("dialog",dialog=>dialog.accept());
  await page.locator("#clearHistory").click();assert.equal(await stored(page),null);
  assert.match(await page.locator("#history").textContent(),/目前沒有作答紀錄/);
});
