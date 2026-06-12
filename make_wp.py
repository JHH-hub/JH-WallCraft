# -*- coding: utf-8 -*-
import sys,math,re,os
from datetime import date,timedelta
from collections import Counter as Ctr
from PIL import Image,ImageDraw,ImageFont
W,H=1536,960
OUT=sys.argv[1] if len(sys.argv)>1 else r'C:\Users\jihuiwang\wallpaper_jh.png'
s=W/3840;lm=round(1150*s);rm=round(120*s);tm=round(100*s)
ct=round(250*s);cw=round(310*s);ch=round(175*s)
tfs=round(56*s);sfs=round(32*s);dfs=round(36*s);smfs=round(18*s);efs=round(18*s)
CONFIG={'countdown':{'name':'\u7b54\u8fa9','date':date(2026,6,24)},
  'milestones':[
    {'name':'\u7efc\u8ff0\u5b8c\u6210','date':date(2026,6,10),'color':(96,165,250)},
    {'name':'\u4ea4\u5f00\u9898\u62a5\u544a\u8868','date':date(2026,6,17),'color':(245,158,11)},
    {'name':'\u7b54\u8fa9','date':date(2026,6,24),'color':(244,63,94)},
  ],
  'marks':[
    {'date':date(2026,6,8),'time':'22:30','color':(168,85,247)},
    {'date':date(2026,6,9),'time':'20:00','color':(168,85,247)},
    {'date':date(2026,6,12),'time':'22:30','color':(168,85,247)},
    {'date':date(2026,6,15),'time':'22:30','color':(168,85,247)},
    {'date':date(2026,6,20),'time':'18:30','color':(168,85,247)},
  ]
}
# Calendar: current month only (June 2026 = 30 days)
import calendar
cal_year=2026;cal_month=6
days_in_month=calendar.monthrange(cal_year,cal_month)[1]
first_weekday=date(cal_year,cal_month,1).weekday()  # Monday=0
# Calculate rows needed
total_cells=first_weekday+days_in_month
cal_rows=math.ceil(total_cells/7)

img=Image.new('RGB',(W,H),(8,8,15))
arr=img.load()
glows=[{'cx':W*0.88,'cy':H*-0.2,'r':max(W,H)*0.5,'c':(80,120,220),'a':0.15},
       {'cx':W*0.96,'cy':H*0.2,'r':max(W,H)*0.4,'c':(160,100,200),'a':0.12},
       {'cx':W*0.75,'cy':H*0.4,'r':max(W,H)*0.45,'c':(100,80,180),'a':0.10}]
for g in glows:
  cx,cy,gr,gc,ga=g['cx'],g['cy'],g['r'],g['c'],g['a']
  x0=max(0,int(cx-gr));x1=min(W,int(cx+gr)+1);y0=max(0,int(cy-gr));y1=min(H,int(cy+gr)+1)
  for py in range(y0,y1):
    for px in range(x0,x1):
      d=math.sqrt((px-cx)**2+(py-cy)**2)
      if d>=gr: continue
      t=d/gr;a=ga*(1-t) if t<0.5 else ga*(1-t)*0.5;a=max(0,a)
      b=arr[px,py];arr[px,py]=tuple(int(b[i]*(1-a)+gc[i]*a) for i in range(3))
draw=ImageDraw.Draw(img)
today=date.today()
def lf(sz):
  for fp in [r'C:\Windows\Fonts\msyh.ttc',r'C:\Windows\Fonts\simhei.ttf']:
    try: return ImageFont.truetype(fp,sz)
    except: pass
  return ImageFont.load_default()
ft=lf(tfs);fs=lf(sfs);fd=lf(dfs);fm2=lf(smfs);fe=lf(efs)
draw.text((lm,tm),str(today.year)+'\u5e74'+str(today.month).zfill(2)+'\u6708',font=ft,fill=(255,255,255))
dl=(CONFIG['countdown']['date']-today).days
ct_txt='\u8ddd'+CONFIG['countdown']['name']+' '+str(dl)+' \u5929' if dl>0 else '\u4eca\u5929\u7b54\u8fa9!'
draw.text((lm,tm+tfs+10),ct_txt,font=fs,fill=(96,165,250))
wm={0:'\u5468\u4e00',1:'\u5468\u4e8c',2:'\u5468\u4e09',3:'\u5468\u56db',4:'\u5468\u4e94',5:'\u5468\u516d',6:'\u5468\u65e5'}
ts='TODAY  '+str(today.month).zfill(2)+'.'+str(today.day).zfill(2)+' '+wm[today.weekday()]
draw.text((W-rm-draw.textlength(ts,font=fm2),tm+20),ts,font=fm2,fill=(136,136,170))
wn=['\u4e00','\u4e8c','\u4e09','\u56db','\u4e94','\u516d','\u65e5']
for i,n in enumerate(wn):
  x=lm+i*cw+cw//2
  draw.text((x-draw.textlength(n,font=fm2)//2,ct-20),n,font=fm2,fill=(255,153,153) if i>=5 else (102,102,136))

# Draw calendar grid - current month only
gt=ct+20;d2c={}
for row in range(cal_rows):
  for col in range(7):
    cell_idx=row*7+col
    day_num=cell_idx-first_weekday+1
    x=lm+col*cw;y=gt+row*ch
    pd=round(4*s);rv=round(8*s)
    if 1<=day_num<=days_in_month:
      d=date(cal_year,cal_month,day_num)
      d2c[d]=(x,y,col,row)
      it=d==today
      if it: draw.rounded_rectangle([x+pd,y+pd,x+cw-pd,y+ch-pd],radius=rv,fill=(30,50,80),outline=(96,165,250),width=2)
      else: draw.rounded_rectangle([x+pd,y+pd,x+cw-pd,y+ch-pd],radius=rv,outline=(37,37,53),width=1)
    else:
      draw.rounded_rectangle([x+pd,y+pd,x+cw-pd,y+ch-pd],radius=rv,outline=(21,21,32),width=1)

bh=round(28*s);tyo=round(70*s)
# Milestones
for ml in CONFIG['milestones']:
  if ml['date'] not in d2c: continue
  x,y,col,row=d2c[ml['date']];tx=x+round(10*s);ty=y+tyo
  tw=round(draw.textlength(ml['name'],font=fe)+16*s)
  draw.rounded_rectangle([tx,ty,tx+tw,ty+bh],radius=round(6*s),fill=ml['color'])
  draw.text((tx+round(8*s),ty+4),ml['name'],font=fe,fill=(255,255,255))
# Friend exam marks - prominent
fmk=lf(14)
for mk in CONFIG.get('marks',[]):
  if mk['date'] not in d2c: continue
  x,y,col,row=d2c[mk['date']]
  # Purple pill badge with time
  pill_txt=mk['time']
  pw=round(draw.textlength(pill_txt,font=fmk)+12)
  ph=16
  px2=x+cw-pw-round(6*s);py2=y+round(6*s)
  draw.rounded_rectangle([px2,py2,px2+pw,py2+ph],radius=7,fill=(168,85,247))
  draw.text((px2+6,py2+1),pill_txt,font=fmk,fill=(255,255,255))
# Date numbers
for row in range(cal_rows):
  for col in range(7):
    cell_idx=row*7+col
    day_num=cell_idx-first_weekday+1
    x=lm+col*cw;y=gt+row*ch
    if 1<=day_num<=days_in_month:
      d=date(cal_year,cal_month,day_num)
      it=d==today;iw=col>=5
      nc=(96,165,250) if it else ((255,153,153) if iw else (255,255,255))
      draw.text((x+round(12*s),y+18),str(day_num),font=fd,fill=nc)
# Legend
ly=gt+cal_rows*ch+12;lx2=lm
for nm,cl in [('\u7efc\u8ff0\u5b8c\u6210',(96,165,250)),('\u4ea4\u5f00\u9898\u62a5\u544a\u8868',(245,158,11)),('\u7b54\u8fa9',(244,63,94)),('\u670b\u53cb\u8003\u8bd5',(168,85,247))]:
  draw.rounded_rectangle([lx2,ly,lx2+round(14*s),ly+round(14*s)],radius=round(3*s),fill=cl)
  draw.text((lx2+round(20*s),ly),nm,font=fm2,fill=(102,102,119));lx2+=round(130*s)
draw.text((lm,H-30),'Generated: '+str(today),font=fm2,fill=(37,37,53))

# === AssetDesk Progress Panel (RIGHT side, below calendar or right-bottom) ===
asset_html=os.path.join(os.path.expanduser('~'),'Documents','GitHub','JH-AssetDesk','animation-tracker.html')
try:
  with open(asset_html,'r',encoding='utf-8') as af: acontent=af.read()
  ps2=acontent.find('projects: [',acontent.find('const DEFAULT_DATA'))
  dep=0;astart=acontent.find('[',ps2);aend=astart
  for ai in range(astart,len(acontent)):
    if acontent[ai]=='[': dep+=1
    elif acontent[ai]==']':
      dep-=1
      if dep==0: aend=ai+1; break
  pblk=acontent[astart:aend]
  pp=re.compile(r'\{\s*\n?\s*id:\s*"([^"]+)",\s*name:\s*"([^"]+)",\s*\n?\s*levels:\s*\[')
  sp2=re.compile(r'state:\s*"(\w+)"')
  ppos=[(m.start(),m.group(1),m.group(2)) for m in pp.finditer(pblk)]
  aproj=[]
  for ai2,(pos2,pid2,pn2) in enumerate(ppos):
    np2=ppos[ai2+1][0] if ai2+1<len(ppos) else len(pblk)
    sts=sp2.findall(pblk[pos2:np2])
    if not sts: continue
    c2=Ctr(sts);t2=len(sts)
    aproj.append({'name':pn2,'total':t2,'done':c2.get('done',0),'todo':c2.get('todo',0),'partial':c2.get('partial',0),'pct':round(c2.get('done',0)/t2*100)})
  all_t=sum(p['total'] for p in aproj);all_d=sum(p['done'] for p in aproj)
  all_rem=all_t-all_d
  # Panel at right-bottom
  panel_x=W-320;panel_y=H-320
  fh2=lf(18);fs4=lf(14);fs5=lf(12)
  draw.text((panel_x,panel_y),'AssetDesk',font=fh2,fill=(124,110,247))
  hdr_txt=' '+str(all_d)+'/'+str(all_t)+' ('+str(round(all_d/all_t*100))+'%)'
  draw.text((panel_x+round(draw.textlength('AssetDesk',font=fh2)),panel_y+3),hdr_txt,font=fs4,fill=(152,152,184))
  # Progress bar
  bar_y2=panel_y+28;bar_w2=260;bar_h2=8
  draw.rounded_rectangle([panel_x,bar_y2,panel_x+bar_w2,bar_y2+bar_h2],radius=3,fill=(30,30,50))
  pct_all=all_d/all_t if all_t>0 else 0
  fill_w2=round(bar_w2*pct_all)
  if fill_w2>0: draw.rounded_rectangle([panel_x,bar_y2,panel_x+fill_w2,bar_y2+bar_h2],radius=3,fill=(74,222,128))
  draw.text((panel_x+bar_w2+8,bar_y2-2),str(round(pct_all*100))+'%',font=fs5,fill=(74,222,128))
  rem_y=bar_y2+16
  draw.text((panel_x,rem_y),'\u5f85\u505a '+str(all_rem)+' \u4e2a',font=fs4,fill=(245,158,11))
  # Project list
  incomplete=[p for p in aproj if p['pct']<100]
  incomplete.sort(key=lambda x: x['pct'])
  row_y2=rem_y+22;row_h2=22
  for pi,p in enumerate(incomplete[:10]):
    nm=p['name']
    if len(nm)>8: nm=nm[:7]+'..'
    draw.text((panel_x,row_y2),nm,font=fs5,fill=(226,226,240))
    mbx=panel_x+100;mby=row_y2+4;mbw=120;mbh=7
    draw.rounded_rectangle([mbx,mby,mbx+mbw,mby+mbh],radius=2,fill=(30,30,50))
    fw3=round(mbw*p['pct']/100)
    if fw3>0:
      bc=(74,222,128) if p['pct']>=80 else (245,158,11) if p['pct']>=40 else (239,68,68)
      draw.rounded_rectangle([mbx,mby,mbx+fw3,mby+mbh],radius=2,fill=bc)
    draw.text((mbx+mbw+6,row_y2),str(p['done'])+'/'+str(p['total']),font=fs5,fill=(152,152,184))
    row_y2+=row_h2
except Exception as ex:
  draw.text((W-320,H-320),'AssetDesk: '+str(ex),font=fm2,fill=(239,68,68))

img.save(OUT,'PNG');print('OK:'+OUT)