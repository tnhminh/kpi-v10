export type Role = "Member" | "Team Leader" | "Department Head" | "Administrator";
export type Confidence = "HIGH" | "MEDIUM" | "LOW" | "REVIEW REQUIRED";
export type ReviewStatus = "Pending" | "In Review" | "Finalized" | "Locked";
export type EvaluationMethod = "AUTO" | "ASSISTED" | "MANUAL";

export interface Team { id:string; name:string; leader:string; members:number; kpiVersion:string; avgSystem:number; avgLeader:number; avgFinal:number; progress:number; quality:Confidence; trend:number }
export interface Member { id:string; name:string; employeeId:string; team:string; jira:string; system:number|null; leader:number|null; final:number|null; confidence:Confidence; status:ReviewStatus; workload:number; trend:number }
export interface Criterion { id:string; name:string; description:string; maxScore:number; method:EvaluationMethod; metric:string; evidence:string; reviewRequired:boolean; threshold:number; scoreAtThreshold:number }

export const teams: Team[] = [
  { id:"api",name:"API",leader:"Nguyen Minh Quan",members:5,kpiVersion:"API-v2",avgSystem:8.43,avgLeader:8.57,avgFinal:8.51,progress:86,quality:"HIGH",trend:.18 },
  { id:"cms",name:"CMS",leader:"Tran Thu Ha",members:4,kpiVersion:"CMS-v1",avgSystem:8.71,avgLeader:8.76,avgFinal:8.72,progress:100,quality:"HIGH",trend:.09 },
  { id:"ads",name:"Ads",leader:"Le Hoang Nam",members:5,kpiVersion:"Ads-v1",avgSystem:8.16,avgLeader:8.34,avgFinal:8.27,progress:74,quality:"MEDIUM",trend:-.21 },
  { id:"payment",name:"Payment",leader:"Pham Gia Bao",members:4,kpiVersion:"Payment-v2",avgSystem:8.89,avgLeader:8.94,avgFinal:8.91,progress:92,quality:"HIGH",trend:.24 },
  { id:"rnd",name:"R&D",leader:"Do Anh Khoa",members:4,kpiVersion:"RND-v1",avgSystem:8.05,avgLeader:8.18,avgFinal:8.12,progress:61,quality:"LOW",trend:-.34 },
  { id:"database",name:"Database",leader:"Vu Bao Chau",members:4,kpiVersion:"DB-v1",avgSystem:8.64,avgLeader:8.62,avgFinal:8.66,progress:83,quality:"HIGH",trend:.11 },
];
export const members: Member[] = [
  { id:"m01",name:"Nguyen Van An",employeeId:"BE-1042",team:"API",jira:"nguyenvanan",system:8.2,leader:8.6,final:8.4,confidence:"HIGH",status:"Finalized",workload:42,trend:-.7 },
  { id:"m02",name:"Le Minh Chau",employeeId:"BE-1051",team:"API",jira:"leminhchau",system:9.1,leader:9.1,final:9.1,confidence:"HIGH",status:"Finalized",workload:37,trend:.3 },
  { id:"m03",name:"Tran Quoc Huy",employeeId:"BE-1067",team:"API",jira:"trquochuy",system:7.9,leader:8.5,final:8.3,confidence:"MEDIUM",status:"In Review",workload:46,trend:-.2 },
  { id:"m04",name:"Pham Thu Trang",employeeId:"BE-1082",team:"Payment",jira:"pthutrang",system:9.3,leader:9.3,final:9.4,confidence:"HIGH",status:"Finalized",workload:31,trend:.5 },
  { id:"m05",name:"Do Gia Han",employeeId:"BE-1098",team:"R&D",jira:"dogiahan",system:null,leader:null,final:null,confidence:"REVIEW REQUIRED",status:"Pending",workload:18,trend:-.9 },
  { id:"m06",name:"Hoang Duc Long",employeeId:"BE-1101",team:"Ads",jira:"hduclong",system:7.7,leader:8.0,final:null,confidence:"LOW",status:"In Review",workload:51,trend:-.5 },
  { id:"m07",name:"Bui Thanh Lam",employeeId:"BE-1116",team:"CMS",jira:"bthlam",system:8.8,leader:8.8,final:8.8,confidence:"HIGH",status:"Finalized",workload:29,trend:.2 },
  { id:"m08",name:"Nguyen My Linh",employeeId:"BE-1124",team:"Database",jira:"nmylinh",system:8.6,leader:8.4,final:8.5,confidence:"HIGH",status:"Finalized",workload:34,trend:.1 },
];
export const initialCriteria: Criterion[] = [
  { id:"delivery",name:"Delivery",description:"Reliable and timely delivery against committed work.",maxScore:3,method:"AUTO",metric:"On-time Completion Rate",evidence:"Jira",reviewRequired:true,threshold:85,scoreAtThreshold:2.5 },
  { id:"quality",name:"Code Quality",description:"Quality signals derived from bugs, reopen and review evidence.",maxScore:2.5,method:"ASSISTED",metric:"Reopen Rate",evidence:"Jira + Review",reviewRequired:true,threshold:8,scoreAtThreshold:2.1 },
  { id:"incident",name:"Incident Support",description:"Operational response and incident resolution contribution.",maxScore:2,method:"AUTO",metric:"Resolution Time",evidence:"Jira",reviewRequired:true,threshold:120,scoreAtThreshold:1.7 },
  { id:"proactive",name:"Proactive Detection",description:"Proactive identification of risks and production issues.",maxScore:1.5,method:"ASSISTED",metric:"Incident Count",evidence:"Jira + Manual Evidence",reviewRequired:true,threshold:3,scoreAtThreshold:1.2 },
  { id:"docs",name:"Documentation",description:"Knowledge sharing and documentation quality.",maxScore:1,method:"MANUAL",metric:"Custom Metric",evidence:"Manual Evidence",reviewRequired:true,threshold:1,scoreAtThreshold:.8 },
];
export const rankRows = [["A+","10.0","1.4"],["A","9.7 – <10","1.3"],["B+","9.4 – <9.7","1.2"],["B","9.0 – <9.4","1.1"],["C","8.0 – <9.0","1.0"],["D","7.5 – <8.0","0.8"],["E","<7.5","0.6"]];
export const reviewCriteria = [
  { name:"Delivery",max:3,metric:"88% on-time",system:2.5,leader:2.8,confidence:"HIGH",evidence:12 },
  { name:"Code Quality",max:2.5,metric:"6.2% reopen",system:2.1,leader:2.2,confidence:"HIGH",evidence:9 },
  { name:"Incident Support",max:2,metric:"104m median",system:1.7,leader:1.7,confidence:"MEDIUM",evidence:4 },
  { name:"Proactive Detection",max:1.5,metric:"3 detections",system:1.1,leader:1.2,confidence:"HIGH",evidence:3 },
  { name:"Documentation",max:1,metric:"Manual",system:.8,leader:.7,confidence:"HIGH",evidence:2 },
];
