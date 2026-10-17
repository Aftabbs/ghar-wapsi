# Ghar Wapsi

India's festival homecoming, animated: every train home, on one map.

Work in progress. See [PLAN.md](PLAN.md) for scope, data sources and the build schedule.

## Data pipeline

```bash
python -m pip install -e ".[dev]"
cd pipeline
python -m ghar.fetch    # downloads raw inputs into data/raw
python -m ghar.build    # writes web/public/data and pipeline/report.json
```

`pipeline/report.json` records every repair the pipeline makes to the 2016 timetable.

## Licences

Code: MIT. Data: see [web/public/data/LICENSES.md](web/public/data/LICENSES.md).
