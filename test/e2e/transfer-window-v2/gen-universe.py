#!/usr/bin/env python3
"""gen-universe.py — the deterministic offline player universe.

The composite eval case's fixture generator (OPTIMUM, "The composite
eval case"): one fixed LCG seed, no network, no wall clock — the same
universe on every machine. Writes, into <out-dir> (default: ./data):
  players.csv   the RAW scout export (messy on purpose: money as
                "£4.20m"/"£650k" strings, padded/double-spaced names,
                mixed-case pos_group — the ingest stage normalizes it)
  window.json   the commission: budget cap, coverage minimums, the
                scout's fit threshold (verify.sh's single source of
truth — the briefs quote it, this file IS it)
"""
import json
import sys
from pathlib import Path

SEED = 20260704
GROUPS = [("gk", 8, (1200, 9000), "gk"),
          ("def", 28, (700, 14000), "cb lb rb"),
          ("mid", 32, (900, 18000), "cm dm am"),
          ("fwd", 28, (1400, 28000), "st lw rw")]
FIRST = ("Ada Bram Cato Dario Emre Felix Goro Hugo Ilya Joko Kai Luca "
         "Milo Nils Omar Pavel Quin Ravi Sami Timo Ugo Viktor Wale Xavi "
         "Yuki Zeno Arne Bo Cyrus Dries Elias Enzo").split()
LAST = ("Jokinen Okafor Varga Silva Kimura Novak Petit Rossi Sagna "
        "Weiss Mbaye Larsen Costa Dufort Eriksen Halland").split()


class Lcg:
    """one deterministic stream — the universe's only source of chance"""

    def __init__(self, seed: int) -> None:
        self.state = seed & 0xFFFFFFFFFFFFFFFF

    def next(self, lo: int, hi: int) -> int:
        self.state = (self.state * 6364136223846793005 + 1442695040888963407) & 0xFFFFFFFFFFFFFFFF
        return lo + (self.state >> 17) % (hi - lo + 1)


def money_gbp_k(raw: int) -> str:
    """the export's money dialect: £X.XXm over a million, else £XXXk"""
    return f"£{raw / 1000:.2f}m" if raw >= 1000 else f"£{raw}k"


def messy_name(rng: Lcg, first: str, last: str) -> str:
    """padded or double-spaced ~half the time — ingest trims it"""
    pick = rng.next(0, 2)
    name = f"{first} {last}"
    if pick == 1:
        return f" {name} "
    if pick == 2:
        return f"{first}  {last}"
    return name


def main() -> None:
    out = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).parent / "data")
    out.mkdir(parents=True, exist_ok=True)
    rng = Lcg(SEED)
    rows = []
    n = 0
    for group, count, (lo, hi), positions in GROUPS:
        for _ in range(count):
            n += 1
            pid = f"p-{n:03d}"
            first, last = FIRST[rng.next(0, len(FIRST) - 1)], LAST[rng.next(0, len(LAST) - 1)]
            age = rng.next(18, 34)
            form = rng.next(55, 96)
            fee = lo + (hi - lo) * (form - 55) // 41  # form drives price
            fee = fee + rng.next(-400, 400)
            if age <= 22:
                fee = fee * 115 // 100  # potential premium
            if age >= 32:
                fee = fee * 70 // 100  # the last contract discount
            fee = max(250, min(28000, fee)) // 25 * 25
            wage = max(5, min(180, fee // 220))
            rows.append([
                pid,
                messy_name(rng, first, last),
                group.upper() if rng.next(0, 1) else group,  # mixed case
                positions.split()[rng.next(0, len(positions.split()) - 1)],
                str(age),
                money_gbp_k(fee),
                f"£{wage}k",
                str(form),
                str(rng.next(1, 5)),
            ])
    with open(out / "players.csv", "w") as f:
        f.write("id,name,pos_group,position,age,fee,wage,form_pct,contract_years\n")
        for row in rows:
            f.write(",".join(row) + "\n")
    window = {"budget_gbp_k": 60000, "min": {"gk": 1, "def": 3, "mid": 3, "fwd": 2}, "fit_threshold": 1.0}
    (out / "window.json").write_text(json.dumps(window, indent=1) + "\n")
    print(f"universe: {len(rows)} players -> {out}/players.csv; window.json cap {window['budget_gbp_k']}k")


if __name__ == "__main__":
    main()
