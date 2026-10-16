(() => {
  'use strict';
  const $=s=>document.querySelector(s), welcome=$('#welcome'),play=$('#play'),topRow=$('#topRow'),bottomRow=$('#bottomRow');
  const turnText=$('#turnText'),message=$('#boardMessage'),toast=$('#toast'),veil=$('#endveil');
  let mode='system', game=null, busy=false, focusPit=-1, audio=null, soundOn=true, toastTimer, pendingMove=null, manualMode=true, twinCapturePits=[], twinTimer=null;
  const variants={classic:{id:'classic',name:'Classic',pits:7,seeds:5},'deep-pits':{id:'deep-pits',name:'Deep Pockets',pits:7,seeds:7},'quick-board':{id:'quick-board',name:'Quick Board',pits:5,seeds:5}};
  let selectedVariant=variants.classic,sides=[];
  let lessonStep=0;
  const lessonSteps=[
    {title:'Meet the board',copy:'There are two rows of {pits} pits. Each pit starts with {seeds} sea shells. You play the near row; your opponent plays the far row. Gather shells into your store.',kind:'board',focus:[]},
    {title:'Choose a pit',copy:'On your turn, click any non-empty pit in your row. Pick up every shell in it. Resting pits are clearly marked REST and cannot be chosen.',kind:'pick',focus:[2]},
    {title:'Sow one by one',copy:'The pit you picked up from is now empty. Click the glowing next pit or press Space to drop one shell at a time, moving clockwise around both rows.',kind:'sow',focus:[3,4,5,6,7]},
    {title:'Keep the Shell Relay going',copy:'After your hand is empty, look at the next pit. If it has shells, pick them all up and sow again. Repeat until the pit after your last shell is empty.',kind:'relay',focus:[5,6,7]},
    {title:'Four-shell Sweep',copy:'When a pit reaches exactly four shells, those four belong to the player who owns that row. Collect them straight into that player’s store, even if the other player sowed them.',kind:'capture',focus:[8]},
    {title:'Twin Catch',copy:'When the pit after your last shell is empty, stop sowing. Take the shells from the pit beyond that empty one and the pit opposite it, if they have any. Then your turn ends.',kind:'twin',focus:[10,3]},
    {title:'Refill for another round',copy:'When a player has no shells left in their row, gather the round. Refill your own pits with {seeds} shells each. If you have fewer than {seeds} shells left for a pit, it becomes a Resting Pit for this round. It may be filled again in a later round. Keep playing until a player cannot refill any pit; that player loses.',kind:'round',focus:[0,13]}
  ];
  const walkthrough=$('#walkthrough'),lessonTitle=$('#lessonTitle'),lessonCopy=$('#lessonCopy'),lessonCount=$('#lessonCount'),lessonVisual=$('#lessonVisual'),lessonProgress=$('#lessonProgress');
  const ring=s=>s.active.map((on,i)=>on?i:-1).filter(i=>i>=0);
  const owner=i=>i<game.pitsPerSide?0:1;
  function chooseVariant(id){selectedVariant=variants[id]||variants.classic;document.querySelectorAll('[data-variant]').forEach(button=>{const active=button.dataset.variant===selectedVariant.id;button.classList.toggle('selected',active);button.setAttribute('aria-pressed',String(active));});const n=selectedVariant.pits,seeds=selectedVariant.seeds,total=n*seeds;$('#selectedBoardName').textContent=`${selectedVariant.name.toUpperCase()} BOARD`;$('#selectedBoardSummary').textContent=`${n*2} pits · ${total*2} shells · ${seeds} each · Four-shell Sweep`;$('#rulesStart').textContent=`Start with ${seeds} shells in each of your ${n} pits. Pick up all shells from one pit and sow one at a time clockwise. When your hand is empty, pick up the next pit and continue until the pit after your last shell is empty. This Shell Relay ends in a Twin Catch: collect shells from the pit beyond that empty pit and the pit opposite it, if they have any. Then your turn passes.`;$('#rulesRefill').textContent=`When a pit reaches exactly four shells, it triggers a Four-shell Sweep: the owner of that row collects those four shells, even if the other player sowed them. When a row runs out, each player refills their own pits with groups of ${seeds}. Any pit you cannot fill because you have fewer than ${seeds} shells left becomes a Resting Pit for that round. It may be filled again in a later round. The first player who cannot refill any pit loses.`;$('#refillTip').textContent=`At round’s end, ${seeds} shells refill one pit. You need ${total} to refill all ${n}; fewer shells leave some pits resting.`;}
  function freshGame(selected,variant=selectedVariant){
    clearTwinCatch();mode=selected;selectedVariant=variant;sides=[Array.from({length:variant.pits},(_,i)=>i),Array.from({length:variant.pits},(_,i)=>variant.pits+i)];game={pits:Array(variant.pits*2).fill(variant.seeds),active:Array(variant.pits*2).fill(true),pitsPerSide:variant.pits,seedsPerPit:variant.seeds,variantId:variant.id,bank:[0,0],side:0,round:1,starter:0,over:false};pendingMove=null;manualMode=true;
    if(mode==='system'){$('#name0').textContent='YOU';$('#name1').textContent='SYSTEM';$('#topName').textContent='SYSTEM';$('#bottomName').textContent='YOU';}
    else{$('#name0').textContent='PLAYER 1';$('#name1').textContent='PLAYER 2';$('#topName').textContent='PLAYER 2';$('#bottomName').textContent='PLAYER 1';}
    welcome.hidden=true;play.hidden=false;veil.hidden=true;busy=false;focusPit=-1;render();maybeAI();
  }
  function createPit(i){const b=document.createElement('button');b.type='button';b.className='pit';b.dataset.pit=String(i);const pitNumber=i<game.pitsPerSide?i+1:game.pits.length-i;b.setAttribute('aria-label',game.active[i]?`Pit ${pitNumber}, ${owner(i)===0?'Player 1':'Player 2'}, ${game.pits[i]} shells`:`Pit ${pitNumber}, resting pit`);b.addEventListener('click',()=>selectPit(i));
    const seeds=document.createElement('span');seeds.className='seeds';const shown=Math.min(game.pits[i],15);for(let j=0;j<shown;j++){const seed=document.createElement('i');seed.className='seed';seed.style.setProperty('--rot',`${(j*37+i*19)%70-35}deg`);seeds.append(seed);}b.append(seeds);
    const count=document.createElement('span');count.className='count';count.textContent=String(game.pits[i]);b.append(count);return b;
  }
  function render(){
    if(!game)return;
    topRow.style.gridTemplateColumns=bottomRow.style.gridTemplateColumns=`repeat(${game.pitsPerSide},minmax(0,1fr))`;topRow.replaceChildren(...sides[1].slice().reverse().map(createPit));bottomRow.replaceChildren(...sides[0].map(createPit));
    const target=pendingMove?dropTarget():-1;
    document.querySelectorAll('.pit').forEach(el=>{const i=Number(el.dataset.pit),owned=owner(i)===game.side,canInteract=!busy&&!game.over&&!(mode==='system'&&game.side===1),valid=pendingMove?i===target:canInteract&&(!owned||(game.active[i]&&game.pits[i]>0));el.disabled=!valid;el.classList.toggle('active-choice',i===focusPit);el.classList.toggle('drop-target',i===target);el.classList.toggle('wrong-row',!pendingMove&&!owned&&canInteract);el.classList.toggle('capture-source',twinCapturePits.includes(i));el.classList.toggle('inactive',!game.active[i]);});
    $('#round').textContent=String(game.round);$('#bank0').textContent=String(game.bank[0]);$('#bank1').textContent=String(game.bank[1]);
    const name=game.side===0?(mode==='system'?'Your turn':'Player 1’s turn'):(mode==='system'?'System is thinking…':'Player 2’s turn');turnText.textContent=game.over?'Round complete':name;
    $('#turnStatusText').textContent=game.over?'Game Over':mode==='system'&&game.side===1?'System Playing':game.side===0?'Player 1 Playing':'Player 2 Playing';
    $('#sowMode').textContent=manualMode?'Hand: On':'Hand: Off';$('#sowMode').setAttribute('aria-pressed',String(manualMode));$('#sowMode').disabled=!!pendingMove||busy;
    const tray=$('#handTray');tray.hidden=!pendingMove;
    if(pendingMove){$('#handCount').textContent=`${pendingMove.hand} shell${pendingMove.hand===1?'':'s'}`;$('#handShells').replaceChildren(...Array.from({length:Math.min(pendingMove.hand,12)},()=>{const x=document.createElement('i');x.className='seed';return x;}));}
    $('#dropOne').disabled=!pendingMove||busy;
    message.textContent=busy?'Shells are finding their way…':pendingMove?'Click the glowing pit or press Space to drop one shell':game.side===0?'Choose a pit with shells':mode==='system'?'The system is choosing a hollow':'Choose one of your pits';
  }
  function copyState(s){return {pits:s.pits.slice(),active:s.active.slice(),bank:s.bank.slice()};}
  function simulate(s,side,start,record=true){
    const events=[],path=ring(s);let ptr=path.indexOf(start),hand=s.pits[start],last=start,loops=0,captured=0;
    if(hand<=0||ptr<0)return {events,captured};
    s.pits[start]=0;if(record)events.push({type:'pick',pit:start});
    while(loops++<1200){
      while(hand>0){ptr=(ptr+1)%path.length;const pit=path[ptr];s.pits[pit]++;hand--;last=pit;if(record)events.push({type:'drop',pit});
        if(s.pits[pit]===4){s.pits[pit]=0;s.bank[owner(pit)]+=4;if(owner(pit)===side)captured+=4;if(record)events.push({type:'fourfold',pit,amount:4,side:owner(pit)});}
      }
      const next=path[(ptr+1)%path.length];
      if(s.pits[next]>0){hand=s.pits[next];s.pits[next]=0;ptr=(ptr+1)%path.length;if(record)events.push({type:'pick',pit:next});continue;}
      const beyond=path[(ptr+2)%path.length];
      const across=s.pits.length-1-beyond;
      for(const target of [beyond,across])if(target!==last&&s.active[target]&&s.pits[target]>0){const amount=s.pits[target];s.pits[target]=0;s.bank[side]+=amount;captured+=amount;if(record)events.push({type:'twinCatch',pit:target,amount,side});}
      break;
    }
    return {events,captured};
  }
  function sound(type,index=0){if(!soundOn)return;try{audio ||= new(window.AudioContext||window.webkitAudioContext)();if(audio.state==='suspended')audio.resume();const osc=audio.createOscillator(),gain=audio.createGain();const now=audio.currentTime;osc.type=type==='drop'?'sine':'triangle';osc.frequency.setValueAtTime(type==='drop'?390+(index%5)*24:type==='fourfold'?720+(index%3)*45:560+(index%4)*60,now);if(type!=='drop')osc.frequency.exponentialRampToValueAtTime(type==='fourfold'?1040:880,now+.10);gain.gain.setValueAtTime(type==='drop'?.027:.045,now);gain.gain.exponentialRampToValueAtTime(.001,now+(type==='drop'?.055:.17));osc.connect(gain);gain.connect(audio.destination);osc.start(now);osc.stop(now+(type==='drop'?.06:.18));}catch(_){}}
  function clearTwinCatch(){if(twinTimer){clearTimeout(twinTimer);twinTimer=null;}twinCapturePits=[];const banner=$('#twinBanner');if(banner)banner.hidden=true;}
  function pitLabel(i){const row=owner(i)===0?(mode==='system'?'Your row':'Player 1'):(mode==='system'?'System':'Player 2'),number=i<game.pitsPerSide?i+1:game.pits.length-i;return `${row} · Pit ${number}`;}
  function showTwinCatch(entries){if(!entries.length)return;if(twinTimer)clearTimeout(twinTimer);twinCapturePits=entries.map(entry=>entry.pit);$('#twinBannerTitle').textContent='Twin Catch!';const total=entries.reduce((n,entry)=>n+entry.amount,0);$('#twinBannerCopy').textContent=`${total} shell${total===1?'':'s'} collected from ${entries.length===1?'this pit':'these pits'}:`;const list=$('#twinCaughtPits');list.replaceChildren(...entries.map(entry=>{const chip=document.createElement('div');chip.className='twin-pit-chip';const label=document.createElement('span');label.textContent=pitLabel(entry.pit);const amount=document.createElement('strong');amount.textContent=`${entry.amount} shell${entry.amount===1?'':'s'}`;chip.append(label,amount);return chip;}));$('#twinBanner').hidden=false;render();twinTimer=setTimeout(()=>{clearTwinCatch();if(game)render();},5200);}
  function animate(events,done){clearTwinCatch();busy=true;render();let idx=0,catchShown=false;const catches=events.filter(event=>event.type==='twinCatch'),speed=mode==='system'&&game.side===1?2:1;function step(){if(idx>=events.length){focusPit=-1;busy=false;render();done();return;}const e=events[idx++];focusPit=e.pit;if(e.type==='drop')sound('drop',idx);else if(e.type==='fourfold')sound('fourfold',idx);else if(e.type==='twinCatch'){if(!catchShown){showTwinCatch(catches);catchShown=true;sound('twinCatch',idx);}}render();setTimeout(step,(e.type==='drop'?58:135)*speed);}step();}
  function validPits(side,s=game){return sides[side].filter(i=>s.active[i]&&s.pits[i]>0);}
  function dropTarget(){if(!pendingMove)return -1;return pendingMove.path[(pendingMove.ptr+1)%pendingMove.path.length];}
  function startHandMove(i){clearTwinCatch();const path=ring(game),ptr=path.indexOf(i);if(ptr<0)return;pendingMove={side:game.side,path,ptr,hand:game.pits[i],last:i};game.pits[i]=0;focusPit=i;sound('pick',i);render();}
  function dropOne(){if(!pendingMove||busy)return;const move=pendingMove;move.ptr=(move.ptr+1)%move.path.length;const pit=move.path[move.ptr];game.pits[pit]++;move.hand--;move.last=pit;sound('drop',pit);if(game.pits[pit]===4){game.pits[pit]=0;game.bank[owner(pit)]+=4;sound('fourfold',pit);say(`${owner(pit)===move.side?'Your row':'Their row'} made a Four-shell Sweep.`);}
    if(move.hand>0){focusPit=pit;render();return;}
    const next=move.path[(move.ptr+1)%move.path.length];
    if(game.pits[next]>0){move.hand=game.pits[next];game.pits[next]=0;move.ptr=(move.ptr+1)%move.path.length;focusPit=next;sound('pick',next);render();return;}
    const beyond=move.path[(move.ptr+2)%move.path.length],across=game.pits.length-1-beyond;let captured=0;const entries=[];
    for(const target of [beyond,across])if(target!==move.last&&game.active[target]&&game.pits[target]>0){const amount=game.pits[target];game.pits[target]=0;game.bank[move.side]+=amount;captured+=amount;entries.push({pit:target,amount});}
    if(captured){sound('twinCatch',pit);showTwinCatch(entries);}
    pendingMove=null;focusPit=-1;render();finishTurn();
  }
  function selectPit(i){if(!game||busy||game.over)return;if(pendingMove){if(i===dropTarget())dropOne();return;}if(mode==='system'&&game.side===1)return;if(owner(i)!==game.side){say('Choose a pit from your side of the row.');return;}if(!game.active[i]){say('That is a Resting Pit. Choose an active pit in your row.');return;}if(game.pits[i]===0)return;if(manualMode){startHandMove(i);return;}sound('pick',i);const out=simulate(game,game.side,i,true);if(!out.events.length)return;animate(out.events,finishTurn);}
  function finishTurn(){
    if(rowEmpty(0)||rowEmpty(1)){endRound();return;}
    game.side=1-game.side;render();maybeAI();
  }
  function rowEmpty(side){return sides[side].every(i=>!game.active[i]||game.pits[i]===0);}
  function endRound(){
    for(let i=0;i<game.pits.length;i++){game.bank[owner(i)]+=game.pits[i];game.pits[i]=0;}
    const filled=[0,0];
    for(let side=0;side<2;side++){
      sides[side].forEach(i=>{game.active[i]=false;});
      for(const i of sides[side])if(game.bank[side]>=game.seedsPerPit){game.bank[side]-=game.seedsPerPit;game.pits[i]=game.seedsPerPit;game.active[i]=true;filled[side]++;}
    }
    if(filled[0]===0||filled[1]===0){game.over=true;render();showEnd(filled);return;}
    game.round++;game.starter=1-game.starter;game.side=game.starter;message.textContent=`Round ${game.round} is ready`;say('A new round. The pits are filled again.');render();maybeAI();
  }
  function showEnd(filled){const title=$('#endTitle'),copy=$('#endCopy');let winner=filled[0]===0?1:filled[1]===0?0:(game.bank[0]===game.bank[1]?-1:game.bank[0]>game.bank[1]?0:1);
    if(winner<0){title.textContent='A lovely draw.';copy.textContent=`You gathered ${game.bank[0]} shells each. Thanks for playing together.`;}
    else{const label=winner===0?(mode==='system'?'You':'Player 1'):(mode==='system'?'The system':'Player 2');title.textContent=`${label} gathered well.`;copy.textContent=`${label} wins this game. Shells left in store: ${game.bank[0]} to ${game.bank[1]}.`;}
    veil.hidden=false;sound('twinCatch',1);
  }
  function maybeAI(){if(mode!=='system'||game.over||game.side!==1)return;if(validPits(1).length===0){endRound();return;}busy=true;render();setTimeout(()=>{const moves=validPits(1),graded=moves.map(i=>{const s=copyState(game),result=simulate(s,1,i,false),selfSeeds=sides[1].reduce((n,p)=>n+s.pits[p],0),otherSeeds=sides[0].reduce((n,p)=>n+s.pits[p],0),opponentGain=s.bank[0]-game.bank[0];return {i,score:result.captured*3-opponentGain*3+selfSeeds*.03-otherSeeds*.006};});const best=Math.max(...graded.map(x=>x.score)),top=graded.filter(x=>x.score>=best-.001);const pick=top[Math.floor(Math.random()*top.length)].i;busy=false;focusPit=-1;const result=simulate(game,1,pick,true);animate(result.events,finishTurn);},1300);}
  function say(text){toast.textContent=text;toast.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.classList.remove('show'),2200);}
  function openLesson(){lessonStep=0;renderLesson();walkthrough.hidden=false;$('#lessonNext').focus();}
  function closeLesson(){walkthrough.hidden=true;}
  function renderLesson(){const step=lessonSteps[lessonStep],n=selectedVariant.pits,seedsEach=selectedVariant.seeds,focus=new Set(step.focus.map(i=>i<7?Math.round(i*(n-1)/6):n+Math.round((i-7)*(n-1)/6)));lessonCount.textContent=`STEP ${lessonStep+1} OF ${lessonSteps.length}`;lessonProgress.style.width=`${((lessonStep+1)/lessonSteps.length)*100}%`;lessonTitle.textContent=step.title;lessonCopy.textContent=step.copy.replaceAll('{pits}',n).replaceAll('{seeds}',seedsEach);
    const pit=(i)=>{const lit=focus.has(i),capture=step.kind==='capture'&&lit,twin=step.kind==='twin'&&lit,inactive=step.kind==='round'&&lit,emptySource=step.kind==='sow'&&i===2,seeds=capture?4:seedsEach;return `<span class="lesson-pit${lit?' focus':''}${capture||twin?' capture':''}${inactive?' inactive':''}" aria-hidden="true">${inactive||emptySource?'':Array.from({length:seeds},()=>'<i></i>').join('')}</span>`;};
    const visualRow=indices=>indices.map(pit).join('');lessonVisual.innerHTML=`<div class="lesson-board step-${step.kind}"><div class="lesson-row" style="grid-template-columns:repeat(${n},24px)">${visualRow(Array.from({length:n},(_,i)=>2*n-1-i))}</div><div class="lesson-arrows">${step.kind==='board'?`${n} PITS EACH · ${seedsEach} SHELLS`:step.kind==='pick'?'PICK UP ALL':step.kind==='sow'?'ONE SHELL PER PIT · SOW ↻':step.kind==='relay'?'PICK UP & CONTINUE':step.kind==='capture'?'4 SHELLS → ROW OWNER':step.kind==='twin'?'TWIN CATCH · TAKE THE PAIR':`REFILL IN GROUPS OF ${seedsEach}`}</div><div class="lesson-row" style="grid-template-columns:repeat(${n},24px)">${visualRow(Array.from({length:n},(_,i)=>i))}</div><div class="lesson-store">✧ &nbsp; YOUR STORE</div></div>`;
    $('#lessonBack').disabled=lessonStep===0;$('#lessonNext').textContent=lessonStep===lessonSteps.length-1?'Got it — let’s play':'Next step →';
  }
  function nextLesson(){if(lessonStep<lessonSteps.length-1){lessonStep++;renderLesson();}else closeLesson();}
  function previousLesson(){if(lessonStep>0){lessonStep--;renderLesson();}}
  chooseVariant('classic');document.querySelectorAll('[data-variant]').forEach(b=>b.addEventListener('click',()=>chooseVariant(b.dataset.variant)));
  document.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>freshGame(b.dataset.mode,selectedVariant)));
  $('#learnBtn').addEventListener('click',openLesson);$('#learnDuringGame').addEventListener('click',openLesson);$('#lessonClose').addEventListener('click',closeLesson);$('#lessonNext').addEventListener('click',nextLesson);$('#lessonBack').addEventListener('click',previousLesson);
  $('#backBtn').addEventListener('click',()=>{if(busy)return;play.hidden=true;welcome.hidden=false;game=null;});
  $('#homeLink').addEventListener('click',e=>{e.preventDefault();if(busy)return;play.hidden=true;welcome.hidden=false;veil.hidden=true;game=null;});
  $('#newGame').addEventListener('click',()=>freshGame(mode,selectedVariant));$('#chooseMode').addEventListener('click',()=>{veil.hidden=true;play.hidden=true;welcome.hidden=false;game=null;});
  function toggleSound(){soundOn=!soundOn;document.querySelectorAll('.sound').forEach(b=>{b.setAttribute('aria-pressed',String(soundOn));if(b.id==='soundToggle')b.innerHTML=`♫ <span>Sound ${soundOn?'on':'off'}</span>`;});if(soundOn)sound('drop',0);}
  $('#soundToggle').addEventListener('click',toggleSound);$('#soundToggle2').addEventListener('click',toggleSound);
  $('#sowMode').addEventListener('click',()=>{if(pendingMove||busy)return;manualMode=!manualMode;render();});$('#dropOne').addEventListener('click',dropOne);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!walkthrough.hidden){closeLesson();return;}if(!walkthrough.hidden&&e.key==='ArrowRight'){nextLesson();return;}if(!walkthrough.hidden&&e.key==='ArrowLeft'){previousLesson();return;}if(pendingMove&&(e.code==='Space'||e.key==='Enter')&&!e.repeat){e.preventDefault();dropOne();return;}if(e.key==='Escape'&&game&&!busy&&!veil.hidden){veil.hidden=true;}});
})();
