import struct, json, numpy as np, torch, torch.nn as nn, torch.nn.functional as F

def load(imgf, lblf):
    with open('/tmp/mnist/'+imgf,'rb') as f:
        _,_,_,_=struct.unpack('>IIII',f.read(16)); a=np.frombuffer(f.read(),np.uint8)
    with open('/tmp/mnist/'+lblf,'rb') as f:
        _,_=struct.unpack('>II',f.read(8)); l=np.frombuffer(f.read(),np.uint8)
    return a.reshape(-1,28,28).astype(np.float32), l.astype(np.int64)

Xtr,Ytr=load('train-images-idx3-ubyte','train-labels-idx1-ubyte')
Xte,Yte=load('t10k-images-idx3-ubyte','t10k-labels-idx1-ubyte')
MEAN,STD=0.1307,0.3081
def norm(x): return ((x/255.0)-MEAN)/STD
Xtr_n=torch.tensor(norm(Xtr)).unsqueeze(1); Ytr_t=torch.tensor(Ytr)
Xte_n=torch.tensor(norm(Xte)).unsqueeze(1); Yte_t=torch.tensor(Yte)

class Net(nn.Module):
    def __init__(s):
        super().__init__()
        s.conv1=nn.Conv2d(1,16,3,padding=1)
        s.ra=nn.Conv2d(16,16,3,padding=1); s.rb=nn.Conv2d(16,16,3,padding=1)  # residual block
        s.conv2=nn.Conv2d(16,32,3,stride=2,padding=1)
        s.fc=nn.Linear(32,10)
    def forward(s,x):
        x=F.relu(s.conv1(x)); x=F.max_pool2d(x,2)         # 8x14x14
        r=F.relu(s.ra(x)); r=s.rb(r); x=F.relu(x+r)        # residual add
        x=F.relu(s.conv2(x))                               # 16x7x7
        x=x.mean(dim=(2,3))                                # global avg pool -> 16
        return s.fc(x)

net=Net(); opt=torch.optim.Adam(net.parameters(),1e-3)
n=Xtr_n.shape[0]
for ep in range(14):
    perm=torch.randperm(n)
    for i in range(0,n,128):
        idx=perm[i:i+128]; opt.zero_grad()
        loss=F.cross_entropy(net(Xtr_n[idx]),Ytr_t[idx]); loss.backward(); opt.step()
    with torch.no_grad():
        acc=(net(Xte_n).argmax(1)==Yte_t).float().mean().item()
    print(f'epoch {ep} test acc {acc:.4f}')

def lst(t,nd=5): return np.round(t.detach().numpy(),nd).tolist()
sd={k:lst(v) for k,v in net.state_dict().items()}
weights={'mean':MEAN,'std':STD,'layers':sd}
json.dump(weights, open('/tmp/nn/weights.json','w'))
# export 12 test digits (raw 0..255 uint8, flat) + labels for "example" mode
samp=[]
for d in range(10):
    i=int(np.where(Yte==d)[0][0]); samp.append({'label':int(d),'px':Xte[i].astype(np.uint8).flatten().tolist()})
i2=int(np.where(Yte==7)[0][3]); samp.append({'label':7,'px':Xte[i2].astype(np.uint8).flatten().tolist()})
i3=int(np.where(Yte==4)[0][2]); samp.append({'label':4,'px':Xte[i3].astype(np.uint8).flatten().tolist()})
json.dump(samp, open('/tmp/nn/samples.json','w'))
import os
print('weights.json', os.path.getsize('/tmp/nn/weights.json')//1024,'KB ; samples', os.path.getsize('/tmp/nn/samples.json')//1024,'KB')
