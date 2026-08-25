# KPI Performance Management Studio

Production-oriented contest prototype for a configurable, explainable performance-management workflow.

## Run

```bash
npm install
npm run dev
```

## Implemented vertical slice

- Session-gated enterprise navigation shell with authenticated user/organization context
- Department dashboard with management attention queue
- Team creation and member management views
- API-backed KPI template/version lifecycle view
- Persistent KPI Builder with criteria, evaluation method, multi-source evidence, metric/scoring configuration and lifecycle controls
- Evaluation periods and system evaluation pipeline
- Leader Review and Department Head Calibration workspace
- Metric Library, Scoring Rules, Data Quality, Jira snapshot integrity, Rank Schemes, Audit Log and Historical Analytics
- Demo data for Backend Department, including missing data and historical integrity scenarios

The core domain behavior is configuration-driven. Team names are demo data only; scoring UI and workflows do not branch on specific team names.
