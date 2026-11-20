#!/usr/bin/env python3
"""Builds frontend/public/data/chennai-bus.json (MTC buses only) from the community ChennaiGTFS feed.
Source: https://github.com/ungalsoththu/ChennaiGTFS (ODbL/PDDL — attribute "UngalSoththu / ChennaiGTFS", keep derivatives open).
Usage: python3 scripts/build-chennai-bus.py chennai-unified-gtfs.zip   (unzipped folder also accepted)"""
import csv, json, sys, os, zipfile, tempfile, collections

src = sys.argv[1]
if src.endswith(".zip"):
    tmp = tempfile.mkdtemp(); zipfile.ZipFile(src).extractall(tmp); src = tmp
rd = lambda n: csv.DictReader(open(os.path.join(src, n), encoding="utf-8-sig", newline=""))
def mins(t):
    h, m, *_ = t.split(":"); return int(h) * 60 + int(m)

routes = {r["route_id"]: r for r in rd("routes.txt") if r["agency_id"] == "69" and r["route_id"].startswith("MTC-")}
trips = {}
for t in rd("trips.txt"):
    if t["route_id"] in routes and t["service_id"] == "MTC-Regular":
        trips[t["trip_id"]] = t["route_id"]
stops_raw = {s["stop_id"]: s for s in rd("stops.txt") if s["stop_id"].startswith("MTC-")}

times = collections.defaultdict(list)
for st in rd("stop_times.txt"):
    if st["trip_id"] in trips and st["arrival_time"]:
        times[st["trip_id"]].append((int(st["stop_sequence"]), st["stop_id"], mins(st["arrival_time"])))

by_route = collections.defaultdict(list)
for tid, seq in times.items():
    seq.sort(); by_route[trips[tid]].append(seq)

stop_index, stops_out = {}, []
def sidx(sid):
    if sid not in stop_index:
        s = stops_raw.get(sid)
        if not s or not s["stop_lat"]: return None
        stop_index[sid] = len(stops_out)
        stops_out.append([s["stop_name"].strip(), round(float(s["stop_lat"]), 5), round(float(s["stop_lon"]), 5)])
    return stop_index[sid]

out = []
for rid, seqs in by_route.items():
    rep = max(seqs, key=len)                     # representative (longest) trip defines the stop pattern
    idx = [(sidx(sid), t) for _, sid, t in rep]
    if any(i is None for i, _ in idx) or len(idx) < 2: continue
    base = rep[0][2]
    r = routes[rid]
    # trips that share the same stop pattern contribute start times; others are skipped to keep offsets valid
    pattern = [sid for _, sid, _ in rep]
    starts = sorted({s[0][2] for s in seqs if [x[1] for x in s] == pattern})
    out.append({"n": r["route_short_name"].strip(), "l": r["route_long_name"].strip(),
                "s": [i for i, _ in idx], "o": [t - base for _, t in idx], "t": starts})
out.sort(key=lambda x: (x["n"], x["l"]))
data = {"v": 1, "city": "Chennai", "agency": "MTC", "collected": "2026-04 (community scrape of the MTC app)",
        "attribution": "UngalSoththu / ChennaiGTFS (ODbL/PDDL)", "stops": stops_out, "routes": out}
dest = os.path.join(os.path.dirname(__file__), "..", "frontend", "public", "data", "chennai-bus.json")
json.dump(data, open(dest, "w"), separators=(",", ":"), ensure_ascii=False)
print("routes", len(out), "stops", len(stops_out), "trips", sum(len(r["t"]) for r in out), "bytes", os.path.getsize(dest))
