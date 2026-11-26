"""Block and ResNet34 definitions from the previously inspected shared step1_smoke.py (309–342)."""
import torch
from torch import nn

class Block(nn.Module):
    def __init__(self, cin, cout, stride):
        super().__init__()
        self.body=nn.Sequential(
            nn.Conv1d(cin,cout,3,stride=stride,padding=1,bias=False),nn.BatchNorm1d(cout),nn.ReLU(),
            nn.Conv1d(cout,cout,3,padding=1,bias=False),nn.BatchNorm1d(cout))
        self.skip=nn.Identity() if cin==cout and stride==1 else nn.Sequential(
            nn.Conv1d(cin,cout,1,stride=stride,bias=False),nn.BatchNorm1d(cout))
        self.relu=nn.ReLU()

    def forward(self,x):
        return self.relu(self.body(x)+self.skip(x))

class ResNet34(nn.Module):
    def __init__(self, median):
        super().__init__()
        layers=[nn.Conv1d(1,64,7,stride=2,padding=3,bias=False),nn.BatchNorm1d(64),nn.ReLU(),
                nn.MaxPool1d(3,stride=2,padding=1)]
        cin=64
        for n,cout in zip((3,4,6,3),(64,128,256,512)):
            for i in range(n):
                layers.append(Block(cin,cout,2 if i==0 and cin!=cout else 1))
                cin=cout
        layers.extend([nn.AdaptiveAvgPool1d(1),nn.Flatten()])
        self.network=nn.Sequential(*layers)
        self.head=nn.Linear(512,1)
        nn.init.zeros_(self.head.weight)
        nn.init.zeros_(self.head.bias)
        self.register_buffer("median",torch.tensor(float(median)))

    def forward(self,x):
        return self.median+10*self.head(self.network(x)).squeeze(-1)
