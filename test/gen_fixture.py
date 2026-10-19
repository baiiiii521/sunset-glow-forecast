#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成算法对照测试的 fixture：用真实 API 数据跑 predict.py，保存输入与输出。
用法：python3 test/gen_fixture.py
输出：test/fixture.json（输入 + Python 结果，供 Node 对照测试使用）
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'sunset-forecast'))
import predict as P  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    fc = P.fetch_forecast(P.LAT, P.LON)
    aq = P.fetch_aq(P.LAT, P.LON)
    daily = fc['daily']
    day_idx = {d: k for k, d in enumerate(daily['time'])}
    today = P.datetime.now(P.TZ).date()
    tomorrow = today + P.timedelta(days=1)
    sunset_dt = P.parse_local(daily['sunset'][day_idx[today.isoformat()]])
    sunrise_dt = P.parse_local(daily['sunrise'][day_idx[tomorrow.isoformat()]])

    def upstream(bearing):
        fcs = []
        for dist in (50, 150, 300):
            lat2, lon2 = P.destination(P.LAT, P.LON, bearing, dist)
            f = P.fetch_forecast(lat2, lon2)
            f['_lat'], f['_lon'] = lat2, lon2
            fcs.append(f)
        return fcs

    b_sunset = P.sunset_bearing(today)
    b_sunrise = P.sunrise_bearing(tomorrow)
    up_sunset = upstream(b_sunset)
    up_sunrise = upstream(b_sunrise)
    res_sunset = P.evaluate(fc, aq, up_sunset, sunset_dt, b_sunset, True)
    res_sunrise = P.evaluate(fc, aq, up_sunrise, sunrise_dt, b_sunrise, False)

    # 分项函数对照电池：验证 JS 移植与 Python 完全一致
    battery = []
    for fn_name, fn, cases in [
        ('cCurtain', P.c_curtain, [(0, 0), (10, 16), (38, 92), (50, 50), (95, 10)]),
        ('cLow', P.c_low, [(4,), (20,), (40,), (80,)]),
        ('cGap', P.c_gap, [(5, 96), (26, 70.7), (10, 30), (10, 31), (None, None), (60, 20)]),
        ('cPrecip', P.c_precip, [(0.8, 99), (0, 11), (0, 45), (0, 0)]),
        ('cWashed', P.c_washed, [(8.2, 0.8, 99), (8.2, 0, 10), (0.5, 0, 10), (0, 0, 0)]),
        ('cAod', P.c_aod, [(0.03,), (0.27,), (0.4,), (0.8,), (1.5,), (None,)]),
        ('cVis', P.c_vis, [(4640,), (9380,), (20000,), (None,)]),
        ('cPm', P.c_pm, [(17.9,), (37.8,), (100,), (None,)]),
        ('cDew', P.c_dew, [(26.4, 24.8), (24.5, 24.3), (20, 10), (None, None)]),
        ('cWind', P.c_wind, [(3.1,), (9.6,), (40,), (None,)]),
        ('cCape', P.c_cape, [(1510, 4, 99), (2500, 60, 80), (100, 10, 10), (None, 0, 0)]),
    ]:
        for args in cases:
            out = fn(*args)
            battery.append({'fn': fn_name, 'args': list(args),
                            'expected': [out[0], out[1]]})

    # 几何函数对照
    battery.append({'fn': 'destination', 'args': [P.LAT, P.LON, 259, 50],
                    'expected': P.destination(P.LAT, P.LON, 259, 50)})
    battery.append({'fn': 'sunsetBearing', 'args': [P.LAT, today.timetuple().tm_yday],
                    'expected': b_sunset})
    battery.append({'fn': 'sunriseBearing', 'args': [P.LAT, tomorrow.timetuple().tm_yday],
                    'expected': b_sunrise})
    battery.append({'fn': 'pyRound', 'args': [68.5], 'expected': round(68.5)})
    battery.append({'fn': 'pyRound', 'args': [69.5], 'expected': round(69.5)})
    battery.append({'fn': 'pyRound', 'args': [40.5], 'expected': round(40.5)})
    battery.append({'fn': 'pyRound', 'args': [2.5], 'expected': round(2.5)})

    fixture = {
        'fc': fc, 'aq': aq,
        'upSunset': up_sunset, 'upSunrise': up_sunrise,
        'sunsetTime': daily['sunset'][day_idx[today.isoformat()]],
        'sunriseTime': daily['sunrise'][day_idx[tomorrow.isoformat()]],
        'offsetSec': fc.get('utc_offset_seconds', 25200),
        'lat': P.LAT, 'lon': P.LON,
        'todayDoy': today.timetuple().tm_yday,
        'tomorrowDoy': tomorrow.timetuple().tm_yday,
        'python': {'sunset': res_sunset, 'sunrise': res_sunrise},
        'battery': battery,
    }
    path = os.path.join(HERE, 'fixture.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(fixture, f, ensure_ascii=False)
    print('fixture 已保存：', path)
    print('Python 今晚晚霞：', res_sunset['grade'], res_sunset['score'], res_sunset['conf'], res_sunset['script'])
    print('Python 明日朝霞：', res_sunrise['grade'], res_sunrise['score'], res_sunrise['conf'], res_sunrise['script'])


if __name__ == '__main__':
    main()
