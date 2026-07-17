const QUESTION_BANK = window.QUESTION_BANK || [];
const EXAMS = {
  ipas_s1:{name:"iPAS 科目一",subtitle:"人工智慧基礎概論",official:"正式規格：50 題／75 分鐘",pace:90,passNote:"練習以 70 分為目標；同時報考兩科的正式授證規則為平均 70 且單科不得低於 60。"},
  ipas_s2:{name:"iPAS 科目二",subtitle:"生成式 AI 應用與規劃",official:"正式規格：50 題／75 分鐘",pace:90,passNote:"練習以 80 分以上為目標；正式授證需與科目一合併判定。"},
  iii:{name:"資策會認證",subtitle:"生成式 AI 能力認證",official:"正式規格：80 題／90 分鐘",pace:67.5,passNote:"正式通過標準為 70 分。"}
};
let selectedExam="ipas_s1";
let session=null;
let timerHandle=null;
const $=s=>document.querySelector(s);
const shuffle=a=>{const b=[...a];for(let i=b.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[b[i],b[j]]=[b[j],b[i]]}return b};
const esc=s=>String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m]));
function renderExamCards(){
  $("#examCards").innerHTML=Object.entries(EXAMS).map(([key,e])=>{const count=QUESTION_BANK.filter(q=>q.exam===key).length;return `<button class="exam-card ${key===selectedExam?"selected":""}" data-exam="${key}"><h3>${e.name}</h3><div>${e.subtitle}</div><div class="meta" style="margin-top:8px">${e.official}</div><div style="margin-top:8px"><span class="badge">本版 ${count} 題</span></div></button>`}).join("");
  document.querySelectorAll(".exam-card").forEach(el=>el.onclick=()=>{selectedExam=el.dataset.exam;renderExamCards();renderCategories()});
}
function renderCategories(){const cats=[...new Set(QUESTION_BANK.filter(q=>q.exam===selectedExam).map(q=>q.category))];$("#category").innerHTML=`<option value="all">全部章節</option>`+cats.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join("")}
function buildQuiz(sourceQuestions,isRetry=false){
  const requested=$("#mode").value;let pool=[...sourceQuestions];
  if(!isRetry){const category=$("#category").value;if(category!=="all")pool=pool.filter(q=>q.category===category);pool=shuffle(pool);const n=requested==="all"?pool.length:Math.min(Number(requested),pool.length);pool=pool.slice(0,n)}
  const shuffleOptions=$("#shuffleOptions").checked;
  const qs=pool.map(q=>{if(!shuffleOptions)return {...q,options:[...q.options],answer:q.answer};const pairs=q.options.map((text,idx)=>({text,correct:idx===q.answer}));const mixed=shuffle(pairs);return {...q,options:mixed.map(x=>x.text),answer:mixed.findIndex(x=>x.correct)}});
  if(!qs.length){alert("這個篩選條件目前沒有題目。");return}
  session={exam:selectedExam,questions:qs,current:0,answers:Array(qs.length).fill(null),marked:Array(qs.length).fill(false),startedAt:Date.now(),isRetry};
  session.secondsLeft=$("#useTimer").checked?Math.ceil(qs.length*EXAMS[selectedExam].pace):null;
  $("#setup").classList.add("hidden");$("#results").classList.add("hidden");$("#history").classList.add("hidden");$("#quiz").classList.remove("hidden");renderQuestion();renderNav();startTimer();
}
function startQuiz(){buildQuiz(QUESTION_BANK.filter(q=>q.exam===selectedExam))}
function startTimer(){clearInterval(timerHandle);if(session.secondsLeft===null){$("#timer").textContent="不限時";return}updateTimer();timerHandle=setInterval(()=>{session.secondsLeft--;updateTimer();if(session.secondsLeft<=0){clearInterval(timerHandle);alert("時間到，系統將自動交卷。");submitQuiz(true)}},1000)}
function updateTimer(){const s=Math.max(0,session.secondsLeft),m=Math.floor(s/60),r=s%60;$("#timer").textContent=`${String(m).padStart(2,"0")}:${String(r).padStart(2,"0")}`;$("#timer").classList.toggle("warn",s<=120)}
function renderQuestion(){
  const q=session.questions[session.current],idx=session.current;$("#progressText").textContent=`第 ${idx+1} 題／共 ${session.questions.length} 題｜已作答 ${session.answers.filter(x=>x!==null).length} 題`;$("#progressBar").style.width=`${((idx+1)/session.questions.length)*100}%`;$("#qCategory").textContent=q.category;$("#qDifficulty").textContent=`難度 ${"★".repeat(q.difficulty)}${"☆".repeat(Math.max(0,3-q.difficulty))}`;$("#qText").textContent=q.question;
  $("#options").innerHTML=q.options.map((op,i)=>`<label class="option ${session.answers[idx]===i?"selected":""}"><input type="radio" name="answer" value="${i}" ${session.answers[idx]===i?"checked":""}><span><strong>${String.fromCharCode(65+i)}.</strong> ${esc(op)}</span></label>`).join("");
  document.querySelectorAll('input[name="answer"]').forEach(el=>el.onchange=()=>{session.answers[idx]=Number(el.value);renderQuestion();renderNav()});$("#prevBtn").disabled=idx===0;$("#nextBtn").disabled=idx===session.questions.length-1;$("#markBtn").textContent=session.marked[idx]?"取消標記":"標記本題";
}
function renderNav(){$("#navGrid").innerHTML=session.questions.map((_,i)=>`<button class="navq ${session.answers[i]!==null?"answered":""} ${i===session.current?"current":""} ${session.marked[i]?"marked":""}" data-i="${i}">${i+1}</button>`).join("");document.querySelectorAll(".navq").forEach(el=>el.onclick=()=>{session.current=Number(el.dataset.i);renderQuestion();renderNav()})}
function submitQuiz(auto=false){const unanswered=session.answers.filter(x=>x===null).length;if(!auto&&unanswered&&!confirm(`尚有 ${unanswered} 題未作答，確定交卷嗎？`))return;clearInterval(timerHandle);const elapsed=Math.round((Date.now()-session.startedAt)/1000);let correct=0;const rows=session.questions.map((q,i)=>{const ok=session.answers[i]===q.answer;if(ok)correct++;return {q,user:session.answers[i],ok}});const score=Math.round(correct/session.questions.length*100);saveHistory({date:new Date().toISOString(),exam:session.exam,count:session.questions.length,correct,score,elapsed});showResults(rows,score,correct,elapsed)}
function formatTime(sec){const m=Math.floor(sec/60),s=sec%60;return `${m} 分 ${s} 秒`}
function showResults(rows,score,correct,elapsed){
  $("#quiz").classList.add("hidden");$("#results").classList.remove("hidden");const byCat={};rows.forEach(r=>{byCat[r.q.category]??={total:0,correct:0};byCat[r.q.category].total++;if(r.ok)byCat[r.q.category].correct++});const breakdown=Object.entries(byCat).map(([c,v])=>`<div class="break-item"><strong>${esc(c)}</strong><br>${v.correct}／${v.total}（${Math.round(v.correct/v.total*100)}%）</div>`).join("");
  const review=rows.map((r,i)=>`<div class="review-card ${r.ok?"correct":"wrong"}" data-review="${r.ok?"correct":"wrong"}"><strong>第 ${i+1} 題｜${esc(r.q.category)}</strong><div style="margin-top:6px">${esc(r.q.question)}</div><div class="answerline ${r.ok?"good":"bad"}">你的答案：${r.user===null?"未作答":String.fromCharCode(65+r.user)+". "+esc(r.q.options[r.user])}</div><div class="answerline good">正確答案：${String.fromCharCode(65+r.q.answer)}. ${esc(r.q.options[r.q.answer])}</div><div class="explain"><strong>解析：</strong>${esc(r.q.explanation)}</div></div>`).join("");const wrongRows=rows.filter(r=>!r.ok);
  $("#results").innerHTML=`<div class="result-hero"><div class="meta">${EXAMS[session.exam].name}｜${EXAMS[session.exam].subtitle}</div><div class="score">${score}</div><div>${correct}／${rows.length} 題正確｜用時 ${formatTime(elapsed)}</div><p class="meta">${EXAMS[session.exam].passNote}</p></div><h3>章節表現</h3><div class="breakdown">${breakdown}</div><div class="btnbar"><button class="btn btn-primary" id="retryWrong" ${wrongRows.length?"":"disabled"}>重做錯題（${wrongRows.length}）</button><button class="btn btn-secondary" id="showWrong">只看錯題</button><button class="btn btn-secondary" id="showAll">顯示全部解析</button><button class="btn btn-secondary" id="backHome">回首頁</button></div><h3 style="margin-top:24px">答案與解析</h3>${review}`;
  $("#retryWrong").onclick=()=>buildQuiz(wrongRows.map(r=>r.q),true);$("#showWrong").onclick=()=>document.querySelectorAll('[data-review="correct"]').forEach(x=>x.classList.add("hidden"));$("#showAll").onclick=()=>document.querySelectorAll('[data-review]').forEach(x=>x.classList.remove("hidden"));$("#backHome").onclick=goHome;
}
function saveHistory(item){const key="aiExamHistoryV01";const arr=JSON.parse(localStorage.getItem(key)||"[]");arr.unshift(item);localStorage.setItem(key,JSON.stringify(arr.slice(0,30)))}
function showHistory(){
  $("#setup").classList.add("hidden");$("#quiz").classList.add("hidden");$("#results").classList.add("hidden");$("#history").classList.remove("hidden");const arr=JSON.parse(localStorage.getItem("aiExamHistoryV01")||"[]");const body=arr.length?`<table class="history-table"><thead><tr><th>日期</th><th>考區</th><th>題數</th><th>分數</th><th>用時</th></tr></thead><tbody>${arr.map(x=>`<tr><td>${new Date(x.date).toLocaleString("zh-TW")}</td><td>${EXAMS[x.exam]?.name||x.exam}</td><td>${x.count}</td><td>${x.score}</td><td>${formatTime(x.elapsed)}</td></tr>`).join("")}</tbody></table>`:`<p class="meta">目前沒有作答紀錄。</p>`;$("#history").innerHTML=`<h2>歷次成績</h2>${body}<div class="btnbar"><button class="btn btn-secondary" id="historyBack">回首頁</button><button class="btn btn-danger" id="clearHistory">清除紀錄</button></div>`;$("#historyBack").onclick=goHome;$("#clearHistory").onclick=()=>{if(confirm("確定清除所有本機成績紀錄？")){localStorage.removeItem("aiExamHistoryV01");showHistory()}};
}
function goHome(){clearInterval(timerHandle);session=null;$("#quiz").classList.add("hidden");$("#results").classList.add("hidden");$("#history").classList.add("hidden");$("#setup").classList.remove("hidden")}
$("#startBtn").onclick=startQuiz;$("#historyBtn").onclick=showHistory;$("#prevBtn").onclick=()=>{if(session.current>0){session.current--;renderQuestion();renderNav()}};$("#nextBtn").onclick=()=>{if(session.current<session.questions.length-1){session.current++;renderQuestion();renderNav()}};$("#markBtn").onclick=()=>{session.marked[session.current]=!session.marked[session.current];renderQuestion();renderNav()};$("#submitBtn").onclick=()=>submitQuiz(false);renderExamCards();renderCategories();
