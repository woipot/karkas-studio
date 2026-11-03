#!/usr/bin/env python3
"""Render a traceable, read-only A3 calculation album from a KARKAS report.

Usage: structural-album.py report.json output.pdf [--assets-dir DIRECTORY]
All geometry, quantities, member IDs and checks come from the report. This
renderer deliberately performs no structural design or connection design.
"""
import argparse
import collections
import datetime
import json
import math
import os
import re
import sys
from pathlib import Path

from reportlab.pdfgen import canvas
from reportlab.lib import colors
from reportlab.lib.pagesizes import A3, landscape
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont


W, H = landscape(A3)
INK = colors.HexColor('#22312f')
MUTED = colors.HexColor('#68736e')
LINE = colors.HexColor('#d6ded7')
PAPER = colors.HexColor('#fafbf7')
WOOD = colors.HexColor('#cba875')
WOOD_DARK = colors.HexColor('#8c6942')
GREEN = colors.HexColor('#3c735d')
LIME = colors.HexColor('#d7e7ae')
ORANGE = colors.HexColor('#aa6533')
RED = colors.HexColor('#a0433d')
BLUE = colors.HexColor('#597e96')
SUPPORT = colors.HexColor('#80658e')
STATUS = 'КР · расчётная проработка / НЕ РАБОЧАЯ ДОКУМЕНТАЦИЯ'


def number(value, digits=2, dash='-'):
    try:
        value = float(value)
        if not math.isfinite(value):
            return dash
        return f'{value:,.{digits}f}'.replace(',', ' ').replace('.', ',')
    except (TypeError, ValueError):
        return dash


def finite(value, default=0):
    try:
        n = float(value)
        return n if math.isfinite(n) else default
    except (TypeError, ValueError):
        return default


def optional_number(value):
    if value is None or value == '':
        return None
    try:
        value = float(value)
        return value if math.isfinite(value) else None
    except (TypeError, ValueError):
        return None


def clean(value):
    if value is None:
        return '-'
    if isinstance(value, bool):
        return 'да' if value else 'нет'
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, separators=(', ', ': '))
    value = str(value).replace('\u2011', '-').replace('\u2013', '-').replace('\u2014', '-').replace('\x00', '')
    # Arial does not contain every mathematical subscript in engine notes.
    return value.translate(str.maketrans({'ᵥ': 'v', 'ₛ': 's', 'ₐ': 'a', 'ₜ': 't', 'ₘ': 'm', 'ₑ': 'e', 'ₖ': 'k', '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9', '⁴': '^4', '∥': '||', '⊥': 'перп.'}))


def xy(point):
    if isinstance(point, dict):
        return finite(point.get('x')), finite(point.get('y', point.get('z')))
    if isinstance(point, (list, tuple)) and len(point) >= 3:
        return finite(point[0]), finite(point[2])
    if isinstance(point, (list, tuple)) and len(point) >= 2:
        return finite(point[0]), finite(point[1])
    return 0, 0


def xyz(point):
    if isinstance(point, dict):
        return finite(point.get('x')), finite(point.get('Y', point.get('height'))), finite(point.get('z', point.get('y')))
    return tuple(finite(x) for x in (list(point or []) + [0, 0, 0])[:3])


def bounds(points):
    pts = list(points)
    if not pts:
        return 0, 0, 1, 1
    return min(p[0] for p in pts), min(p[1] for p in pts), max(p[0] for p in pts), max(p[1] for p in pts)


def scan_intervals(points, ordinate):
    """Exact horizontal scanline intervals of a simple plan polygon."""
    hits = []
    for a, b in zip(points, points[1:] + points[:1]):
        if (a[1] <= ordinate < b[1]) or (b[1] <= ordinate < a[1]):
            hits.append(a[0] + (ordinate - a[1]) / (b[1] - a[1]) * (b[0] - a[0]))
    hits.sort()
    return list(zip(hits[::2], hits[1::2]))


def subtract_intervals(base, voids):
    result = list(base)
    for a, b in voids:
        output = []
        for lo, hi in result:
            if b <= lo or a >= hi:
                output.append((lo, hi))
            else:
                if lo < a:
                    output.append((lo, a))
                if b < hi:
                    output.append((b, hi))
        result = output
    return result


def inside_polygon(point, polygon_):
    x, y = point
    inside = False
    for a, b in zip(polygon_, polygon_[1:] + polygon_[:1]):
        if (a[1] > y) != (b[1] > y):
            crossing = a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1])
            if x < crossing:
                inside = not inside
    return inside


def transform(points, box, padding=24, uniform=True):
    x, y, w, h = box
    a, b, c, d = bounds(points)
    sx = (w - 2 * padding) / max(c - a, .01)
    sy = (h - 2 * padding) / max(d - b, .01)
    if uniform:
        sx = sy = min(sx, sy)
    ox = x + (w - (c - a) * sx) / 2
    oy = y + (h - (d - b) * sy) / 2
    return lambda p: (ox + (p[0] - a) * sx, oy + (p[1] - b) * sy), sx


def register_fonts(assets=None):
    options = [Path(assets)] if assets else []
    options += [Path('/System/Library/Fonts/Supplemental'), Path('/usr/share/fonts/truetype/dejavu'), Path('/usr/share/fonts/truetype/liberation2')]
    fonts = {
        'Body': ('Arial.ttf', 'DejaVuSans.ttf', 'LiberationSans-Regular.ttf'),
        'Bold': ('Arial Bold.ttf', 'DejaVuSans-Bold.ttf', 'LiberationSans-Bold.ttf'),
        'Italic': ('Arial Italic.ttf', 'DejaVuSans-Oblique.ttf', 'LiberationSans-Italic.ttf'),
        'Mono': ('Courier New.ttf', 'DejaVuSansMono.ttf', 'LiberationMono-Regular.ttf'),
    }
    for name, candidates in fonts.items():
        path = next((folder / f for folder in options for f in candidates if (folder / f).exists()), None)
        if not path:
            raise RuntimeError('Не найден шрифт с кириллицей: ' + name)
        pdfmetrics.registerFont(TTFont(name, str(path)))


def wrap(text, width, font='Body', size=8):
    text = clean(text)
    output = []
    for paragraph in text.split('\n'):
        line = ''
        for word in paragraph.split(' '):
            candidate = (line + ' ' + word).strip()
            if pdfmetrics.stringWidth(candidate, font, size) <= width:
                line = candidate
                continue
            if line:
                output.append(line)
                line = ''
            chunk = ''
            for character in word:
                if chunk and pdfmetrics.stringWidth(chunk + character, font, size) > width:
                    output.append(chunk)
                    chunk = ''
                chunk += character
            line = chunk
        output.append(line)
    return output or ['']


def text(c, value, x, y, size=8, font='Body', color=INK, width=None, leading=None):
    c.setFillColor(color)
    c.setFont(font, size)
    lines = wrap(value, width, font, size) if width else clean(value).split('\n')
    leading = leading or size * 1.28
    for line in lines:
        c.drawString(x, y, line)
        y -= leading
    return y


def line(c, a, b, color=LINE, width=.6, dash=None):
    c.setStrokeColor(color)
    c.setLineWidth(width)
    c.setDash(dash or [])
    c.line(a[0], a[1], b[0], b[1])
    c.setDash([])


def polygon(c, points, fill=None, stroke=INK, width=.8):
    if len(points) < 2:
        return
    p = c.beginPath()
    p.moveTo(*points[0])
    for point in points[1:]:
        p.lineTo(*point)
    p.close()
    c.setLineWidth(width)
    c.setStrokeColor(stroke or colors.white)
    c.setFillColor(fill or colors.white)
    c.drawPath(p, stroke=int(stroke is not None), fill=int(fill is not None))


def arrow(c, a, b, color=BLUE, width=1):
    line(c, a, b, color, width)
    angle = math.atan2(b[1] - a[1], b[0] - a[0])
    for turn in (-.45, .45):
        line(c, b, (b[0] - 5 * math.cos(angle + turn), b[1] - 5 * math.sin(angle + turn)), color, width)


def badge(c, label, x, y, color=GREEN, size=7.5):
    w = pdfmetrics.stringWidth(clean(label), 'Bold', size) + 13
    c.setFillColor(color)
    c.roundRect(x, y - 4, w, 16, 4, fill=1, stroke=0)
    text(c, label, x + 6, y + 1, size, 'Bold', colors.white)
    return w


def dimension(c, a, b, offset=15, label=None):
    dx, dy = b[0] - a[0], b[1] - a[1]
    length = math.hypot(dx, dy)
    if length < 1:
        return
    nx, ny = -dy / length, dx / length
    aa, bb = (a[0] + nx * offset, a[1] + ny * offset), (b[0] + nx * offset, b[1] + ny * offset)
    line(c, a, (aa[0] + nx * 3, aa[1] + ny * 3), MUTED, .4)
    line(c, b, (bb[0] + nx * 3, bb[1] + ny * 3), MUTED, .4)
    line(c, aa, bb, MUTED, .45)
    for p in (aa, bb):
        line(c, (p[0] - 2, p[1] - 3), (p[0] + 2, p[1] + 3), INK, .6)
    label = clean(label or '')
    tx, ty = (aa[0] + bb[0]) / 2, (aa[1] + bb[1]) / 2
    c.saveState()
    c.translate(tx, ty)
    angle = math.degrees(math.atan2(dy, dx))
    if angle > 90 or angle < -90:
        angle += 180
    c.rotate(angle)
    tw = pdfmetrics.stringWidth(label, 'Body', 7)
    c.setFillColor(colors.white)
    c.rect(-tw / 2 - 3, -2, tw + 6, 10, fill=1, stroke=0)
    text(c, label, -tw / 2, 1, 7)
    c.restoreState()


ROLE = {'stud': 'Стойка', 'plate': 'Обвязка', 'corner': 'Угол', 'joist': 'Лага', 'rim': 'Бортовая доска', 'rimJoist': 'Обвязка перекрытия', 'floorBlocking': 'Поперечные распорки', 'voidHeader': 'Ригель проёма', 'voidTrimmer': 'Обрамление проёма', 'openingHeader': 'Поперечная балка проёма', 'openingTrimmer': 'Продольная балка проёма', 'rafter': 'Стропило', 'truss': 'Ферма', 'letInBrace': 'Врезная укосина', 'blocking': 'Распорка', 'grillage': 'Ростверк', 'beam': 'Балка', 'header': 'Перемычка', 'kingStud': 'Стойка проёма', 'jackStud': 'Опорная стойка', 'sill': 'Подоконная доска', 'annexRim': 'Обвязка настила пристройки', 'annexJoist': 'Лага пристройки', 'annexBlocking': 'Распорки пристройки', 'annexPostBearingBlock': 'Опорные вкладыши стоек', 'stairTread': 'Доска ступени', 'stairRiser': 'Подступенок', 'stairStringer': 'Пильный косоур', 'stairHandrail': 'Поручень марша', 'stairBaluster': 'Заполнение марша', 'guardPost': 'Стойка ограждения', 'guardRail': 'Пояс ограждения', 'guardBaluster': 'Заполнение ограждения'}
STATUSES = {'pass': 'Частная проверка выполнена', 'fail': 'Не выполнено', 'warning': 'Требует уточнения', 'unverified': 'Не проверено', 'blocked': 'Заблокировано', 'complete': 'Сформировано'}


class Album:
    def __init__(self, report):
        self.report = report
        self.p = report.get('project') or {}
        self.r = report.get('result') or {}
        self.engine = report.get('engine') or {}
        self.release = '.'.join(clean(self.engine.get('version', '4.0')).split('.')[:2])
        self.planning = report.get('planning') or self.r.get('planning') or {}
        self.cut = report.get('cutting') or {}
        self.estimate = report.get('estimate') or {}
        self.g = self.r.get('geometry') or {}
        self.roof = self.r.get('roofModel') or {}
        self.gr = self.r.get('grillageModel') or {}
        self.members = (self.r.get('timber') or {}).get('instances') or []
        self.spatial = self.r.get('spatialLayout') or {}
        self.annexes = (self.r.get('annexes') or {}).get('items') or []
        self.fabrication = report.get('fabrication') or {}
        self.part_groups = self.fabrication.get('partGroups') or []
        self.pattern_groups = self.fabrication.get('patternGroups') or []
        self.marks = self.fabrication.get('partToGroup') or {str(m.get('id')): f'Д-{i + 1:04d}' for i, m in enumerate(self.members)}
        self.wall_map = {str(w.get('id')): w for w in self.p.get('walls', [])}
        self.wall_names = {str(w.get('id')): f'Стена {i + 1:02d}' for i, w in enumerate(self.p.get('walls', []))}
        self.levels = self.g.get('levels') or []
        self.pages = []
        self.currency = self.estimate.get('currency') or (self.p.get('prices') or {}).get('currency') or 'RUB'
        self.unit_money = {'EUR': 'EUR', 'RUB': 'RUB', 'USD': 'USD'}.get(self.currency, clean(self.currency))
        self.plan()

    def add(self, title, kind, data=None, subtitle=''):
        self.pages.append({'title': title, 'kind': kind, 'data': data, 'subtitle': subtitle})

    def table_pages(self, title, columns, rows, subtitle='', size=8):
        """Paginate by measured cell height, including wrapping of full IDs."""
        available = H - 250
        pending, height = [], 0
        widths = [(W - 84) * col[1] for col in columns]
        for row in rows:
            cell_lines = [wrap(cell, widths[i] - 12, 'Mono' if columns[i][2:] and columns[i][2] == 'mono' else 'Body', size) for i, cell in enumerate(row)]
            rh = max(len(v) for v in cell_lines) * size * 1.25 + 10
            if pending and height + rh > available:
                self.add(title, 'table', (columns, pending, size), subtitle)
                pending, height = [], 0
            pending.append((row, rh))
            height += rh
        self.add(title, 'table', (columns, pending, size), subtitle)

    def plan(self):
        self.add('КР · расчётная проработка', 'cover')
        self.add('Ведомость листов', 'contents')
        self.add('Исходные данные, единицы и область расчёта', 'assumptions')
        selection = self.report.get('foundationSelection') or self.r.get('foundationSelection') or (self.p.get('foundation') or {}).get('selection') or {}
        if self.p.get('site') or selection:
            self.add('Площадка и выбор фундамента', 'site')
            if self.p.get('site'):
                self.table_pages('Площадка · принятые нормативные исходные', [('Параметр', .35), ('Данные исходного отчёта', .65)], self.flatten_fields(self.p['site']), 'Регион, нормативная база и значения приняты из проекта; применимость требует подтверждения.', 8)
            if selection:
                candidates = selection.get('candidates') if isinstance(selection, dict) else None
                if candidates:
                    candidate_rows = []
                    for candidate in candidates:
                        note = '\n'.join([clean(candidate.get('notes', '')), 'Условия: ' + clean(candidate.get('conditions')), 'Исключения: ' + clean(candidate.get('exclusions'))])
                        candidate_rows.append([candidate.get('name', candidate.get('type')), {'conditional': 'Предварительный вариант · требует проверки', 'excluded': 'Исключён'}.get(candidate.get('status'), candidate.get('status')), number(candidate.get('designResistance'), 2), number(candidate.get('pileLength'), 2), number(candidate.get('steelDiameter'), 0), note])
                    self.table_pages('Фундамент · сравнение свайных систем', [('Система', .17), ('Статус', .13), ('Rd, кН', .08), ('Длина, м', .08), ('Ø, мм', .08), ('Условия и ограничения', .46)], candidate_rows, '«-» означает, что значение не задано. Условный выбор не подтверждает грунт, сопротивление или размеры сваи.', 8)
                    remaining = {k: v for k, v in selection.items() if k != 'candidates'}
                else:
                    remaining = selection
                self.table_pages('Фундамент · исходные выбора и исследования', [('Параметр / вариант', .35), ('Данные исходного отчёта', .65)], self.flatten_fields(remaining), 'Данные задания и сравнения систем, не подтверждённый геотехнический расчёт.', 8)
        for level in self.levels:
            self.add(f'План этажа {level.get("index", 1)}', 'floorplan', level, 'Размерные цепи - между осями стен; зелёный контур - наружная грань платформы. Размеры в мм, координаты и отметки в м.')
        for space in self.spatial.get('doubleHeightSpaces') or []:
            self.add('Второй свет · лестница, галерея и верхний ярус', 'spatial', space, 'Единый пространственный объём и проекции фактических деревянных элементов. Узлы лестницы и ограждений требуют проверки.')
        if self.annexes:
            self.add('Пристройки · конструктивные варианты', 'annexcatalog', self.annexes, 'Поддерживаемые варианты MCP и фактический состав текущей модели. Пристройки не включены в отапливаемую площадь дома.')
            for annex in self.annexes:
                self.add('Пристройка · ' + clean(annex.get('name', annex.get('id'))), 'annex', annex, 'Геометрия, опоры, кровля и остекление из отчёта. Древесина включена в общие FG / FP и раскрой ровно один раз.')
                rows = []
                for q in annex.get('checks') or []:
                    rows.append([q.get('label', q.get('id')), STATUSES.get(q.get('status'), q.get('status')), self.check_value(q), q.get('note', '')])
                if rows:
                    self.table_pages('Пристройка · проверки · ' + clean(annex.get('name', annex.get('id'))), [('Проверка', .25), ('Статус', .13), ('Значение / предел', .17), ('Пояснение', .45)], rows, 'Частные проверки из модели; геотехника, крепёж и пространственная устойчивость не подтверждены.', 7.8)
        openings = self.p.get('openings') or []
        if openings:
            self.table_pages('Проёмы · ведомость окон и дверей', [('ID проёма', .2, 'mono'), ('Стена', .12), ('Тип / этаж', .12), ('От A, мм', .12), ('Ширина, мм', .12), ('Высота, мм', .12), ('Низ от основания стены, мм', .2)], [[o.get('id'), self.wall_names.get(str(o.get('wallId')), o.get('wallId')), ('Дверь' if o.get('type') == 'door' else 'Окно') + f' / {o.get("floor", o.get("level", "-"))}', number(finite(o.get('offset')) * 1000, 0), number(finite(o.get('width')) * 1000, 0), number(finite(o.get('height')) * 1000, 0), number(finite(o.get('sill')) * 1000, 0)] for o in openings], 'Отступ измеряется вдоль локальной оси стены A → B. Конструктивные перемычки и опорные стойки - на фасадах каркаса.', 8)
        if self.planning.get('rooms'):
            self.table_pages('Помещения · экспликация', [('ID', .16, 'mono'), ('Этаж', .07), ('Наименование', .33), ('Площадь, м²', .15), ('Чистые габариты, м', .29)], [[room.get('id'), room.get('level', room.get('floor')), room.get('name'), number(room.get('area'), 3), self.room_dimensions(room)] for room in self.planning['rooms']], 'Площади из отчёта; чистые габариты - между гранями полигонов помещений. Расстановка мебели не добавляет расчётную массу.', 8)
        self.add('Свайное поле', 'piles', subtitle='Положение и расчётные реакции по модели. Несущая способность грунта не подтверждена геологией.')
        self.add('Ростверк · общий план и уровни', 'grillage')
        alignment_nodes = self.platform_alignment_nodes()
        if alignment_nodes:
            self.add('Платформа, каркас и ростверк · наружные грани', 'platformdetails', alignment_nodes[:2], 'Размеры по фактической геометрии отчёта. Совпадение граней и полоса опирания не подтверждают расчёт соединений.')
        beams = self.gr.get('beams') or []
        for i in range(0, len(beams), 3):
            self.add('Ростверк · раскладка пакетов по слоям', 'beamcards', beams[i:i + 3], 'Только фактические доски и стыки из модели; длина исходной доски 6 000 мм.')
        span_rows = []
        for s in self.gr.get('spans') or []:
            q = s.get('check') or {}
            span_rows.append([s.get('id'), f'{s.get("startPileId", "-")} / {s.get("endPileId", "-")}', number(s.get('length'), 3), number(s.get('designTotal'), 3), number(s.get('serviceTotal'), 3), number(q.get('bendingStress'), 3), number(q.get('shearStress'), 3), f'{number(q.get("deflection"), 3)} / {number(q.get("deflectionLimit"), 3)}', number(q.get('utilization'), 3), STATUSES.get(q.get('status'), q.get('status', '-'))])
        self.table_pages('Ростверк · пролёты и частные проверки', [('Пролёт', .12, 'mono'), ('Опоры', .12, 'mono'), ('L, м', .065), ('Fd, кН', .075), ('Fk, кН', .075), ('σm, МПа', .085), ('τ, МПа', .08), ('f / flim, мм', .13), ('η', .065), ('Результат', .185)], span_rows, 'Сборка пакета, оголовки, анкеры и грунт отдельно не рассчитаны.', 7.4)
        piles = self.gr.get('piles') or self.r.get('piles') or []
        self.table_pages('Ведомость свай и реакций', [('Свая', .13, 'mono'), ('X, м', .1), ('Y, м', .1), ('Fd, кН', .13), ('Fk, кН', .13), ('η', .1), ('Оголовок, мм', .12), ('Статус модели', .19)], [[p.get('id'), number(p.get('x'), 3), number(p.get('y'), 3), number(p.get('reaction'), 3), number(p.get('reactionCharacteristic'), 3), number(p.get('utilization'), 3), number(p.get('capSize'), 0), STATUSES.get(p.get('status'), p.get('status', '-'))] for p in piles], 'Реакция сваи не является подтверждением её геотехнической несущей способности.')
        for level in self.levels:
            self.add(f'Перекрытие этажа {level.get("index", 1)}', 'floorframing', level, 'Фактические доски, обрамление проёмов и опоры. Узлы передачи усилий требуют проектирования.')
        floor_openings = self.r.get('floorOpenings')
        if isinstance(floor_openings, dict):
            rows, remarks = [], []
            support_labels = {'lowerWallEnds': 'Концы на стенах нижнего этажа', 'continuousWall': 'Непрерывная опора на стену', 'trimmerFaces': 'Торцы у продольных балок'}
            logical_members = [m for opening in floor_openings.get('openings') or [] for m in (opening.get('trimmers') or []) + (opening.get('headers') or [])]
            for board in logical_members or floor_openings.get('instances') or []:
                if not isinstance(board, dict):
                    continue
                check = board.get('check') if isinstance(board.get('check'), dict) else {}
                support_rows = []
                for support in board.get('supports') or []:
                    if not isinstance(support, dict):
                        continue
                    if support.get('wallId') is not None:
                        support_rows.append(self.wall_names.get(str(support['wallId']), 'Стена') + '\n' + clean(support['wallId']))
                    elif support.get('memberId') is not None:
                        support_rows.append('Балка\n' + clean(support['memberId']))
                mode = clean(board.get('supportMode'))
                status = STATUSES.get(check.get('status'), clean(check.get('status'))) if check else 'Балочная проверка не передана'
                marks = list(dict.fromkeys(self.marks.get(str(mid)) for mid in board.get('memberIds') or [board.get('id')] if self.marks.get(str(mid))))
                section = board.get('boardSection') or {}
                section_label = f'{board.get("plies")} × {section.get("b")} × {section.get("h")}' if board.get('analysisOnly') and board.get('plies') else f'{board.get("b", "-")} × {board.get("h", "-")}'
                rows.append([(', '.join(marks) + '\n' if marks else '') + clean(board.get('id')), board.get('voidId'), section_label, number(board.get('analyticalSpan'), 3) + ' / ' + number(board.get('clearSpan'), 3), '\n'.join(support_rows) or '-', number(check.get('maxMoment'), 4), number(check.get('maxShear'), 4), number(check.get('deflection'), 3) + ' / ' + number(check.get('deflectionLimit'), 3), number(check.get('utilization'), 4), support_labels.get(mode, mode) + '\n' + mode + '\n' + status])
                loads = board.get('loads') if isinstance(board.get('loads'), dict) else {}
                notes = ['Роль: ' + clean(board.get('role')) + '; опорная схема: ' + mode + '.']
                if board.get('analysisOnly') and board.get('plies'):
                    notes.append('Пакет ' + section_label + ' мм. Это расчётная ось, не одна широкая доска. В физической модели ' + str(len(board.get('memberIds') or [])) + ' отдельных досок; равномерная передача нагрузки между ними и крепёж не подтверждены.')
                if loads:
                    notes.append('Грузовая модель: ' + clean(loads.get('method')) + '; qd / qk = ' + number(loads.get('designLineLoad'), 4) + ' / ' + number(loads.get('serviceLineLoad'), 4) + ' кН/м.')
                    for reaction in loads.get('headerReactions') or []:
                        if isinstance(reaction, dict):
                            notes.append('Реакция балки ' + clean(reaction.get('sourceHeaderId')) + ': x=' + number(reaction.get('at'), 3) + ' м; Fd / Fk=' + number(reaction.get('design'), 4) + ' / ' + number(reaction.get('characteristic'), 4) + ' кН.')
                if check:
                    notes.append('Концевые реакции A / B: ' + number(check.get('reactionStart'), 4) + ' / ' + number(check.get('reactionEnd'), 4) + ' кН; Fd=' + number(check.get('designTotal'), 4) + ' кН.')
                else:
                    notes.append('Проверка M/V/прогиба не передана; значения не подставлены.')
                direct = board.get('directWallReaction') if isinstance(board.get('directWallReaction'), dict) else {}
                if direct:
                    notes.append('Прямая передача на нижнюю стену: Fd / Fk = ' + number(direct.get('design'), 4) + ' / ' + number(direct.get('service'), 4) + ' кН; стены: ' + ', '.join(clean(v) for v in direct.get('wallIds', [direct.get('wallId')])) + '.')
                if board.get('connectionVerified') is not True:
                    notes.append('Соединения, смятие, эксцентриситет, боковая устойчивость и передача усилий через стену не подтверждены.')
                remarks.append([board.get('id'), '\n'.join(notes)])
            for i, assumption in enumerate(floor_openings.get('assumptions') or []):
                remarks.append([f'Допущение обрамления {i + 1:02d}', clean(assumption)])
            self.table_pages('Обрамление второго света и лестницы · опоры и проверки', [('Балка / марки досок', .18, 'mono'), ('ID проёма', .11, 'mono'), ('n × b × h, мм', .075), ('Lрасч. / Lчист., м', .085), ('Опорные стены / балки', .14), ('Mmax, кНм', .065), ('Vmax, кН', .065), ('δ / δlim, мм', .09), ('η', .055), ('Опорная схема / статус', .135)], rows, 'Пакеты подписаны n × b × h одной доски. Нагрузки и частные проверки - по расчётной оси пакета; все отдельные доски сохранены в раскрое. «-» - значение не передано.', 7)
            self.table_pages('Обрамление проёмов · передача нагрузок и допущения', [('Доска / раздел', .23, 'mono'), ('Данные модели и границы расчёта', .77)], remarks, 'Конструктивные соединения, ползучесть, вибрация, смятие и пространственная работа не подтверждены.', 7.3)
        walls = self.p.get('walls') or []
        # Two walls per sheet keeps IDs, openings and high/raked profiles readable.
        for i in range(0, len(walls), 2):
            self.add('Фасады каркаса стен', 'wallframes', walls[i:i + 2], 'Вид со стороны локальной оси стены A → B; размеры в мм, отметки в м.')
        self.add('Кровля · план зон и сток', 'roofplan')
        zones = self.roof.get('zones') or []
        for i in range(0, len(zones), 2):
            self.add('Кровля · несущие схемы и разрезы', 'roofsections', zones[i:i + 2], 'Показана геометрия фактических элементов. Опорные узлы и крепёж не подтверждены.')
        has_second_light = any(v.get('kind') == 'doubleHeight' for v in self.p.get('voids') or [])
        self.add('Разрез здания через второй свет' if has_second_light else 'Разрез здания', 'section', subtitle='Отметки по фактической модели; пересечение выбрано через пустоту перекрытия.' if has_second_light else 'Пересечение стен, платформы и кровли фактической модели.')
        self.add('Типовые узлы · геометрия сборки', 'details', subtitle='ГЕОМЕТРИЯ. Крепёж, анкеры, опирание и совместная работа отдельно не рассчитаны.')
        for junction in (self.p.get('envelope') or {}).get('junctionDetails') or []:
            if isinstance(junction, dict) and junction.get('kind') == 'insulatedTwoStud':
                self.add('Утепляемый двухстоечный угол · непрерывность слоёв', 'insulatedcorner', junction, 'Схема сопряжения каркаса и оболочки. Герметичность, тепловой мост и рабочие соединения не подтверждены.')
        bracing = self.r.get('bracingModel') or {}
        if bracing.get('wallLines'):
            rows = [[self.wall_names.get(str(w.get('wallId')), w.get('wallId')), w.get('level'), number(w.get('length'), 3), number(w.get('availableLength'), 3), number(w.get('demandShear'), 3), number(w.get('designShear'), 3), number(w.get('capacity'), 3), number(w.get('utilization'), 3), '; '.join(clean(q.get('note') or q.get('label')) for q in w.get('checks', []))] for w in bracing['wallLines']]
            self.table_pages('Пространственная жёсткость стен', [('Стена', .105), ('Этаж', .05), ('L, м', .065), ('Раб. L, м', .075), ('Vd, кН', .075), ('Rd, кН/м', .075), ('R, кН', .065), ('η', .05), ('Проверки и ограничения', .44)], rows, 'Диафрагмы/врезные укосины по модели; крепёж, анкеры и путь усилий должны быть подтверждены.', 7.2)
        self.add('Нагрузки · сводка и исходные значения', 'loads')
        snow = self.r.get('snowAssessment')
        if isinstance(snow, dict):
            cases = snow.get('cases') if isinstance(snow.get('cases'), list) else []
            for offset in range(0, max(1, len(cases)), 4):
                self.add('Снег · фиксированные сечения и сценарии', 'snow', (snow, cases[offset:offset + 4]), 'Распределения нагрузки из отчёта. Автоподбор сечений между снеговыми случаями отключён.')
            failures = []
            for case in cases:
                if not isinstance(case, dict):
                    continue
                for q in case.get('failures') or []:
                    if isinstance(q, dict):
                        failures.append([case.get('name', case.get('id')), q.get('label', q.get('id')), self.check_value(q), q.get('note', '')])
            if failures:
                self.table_pages('Снег · невыполненные частные проверки', [('Случай', .18), ('Проверка', .24), ('Значение / предел', .18), ('Пояснение', .4)], failures, 'Данные каждого снегового случая; не заменяют нормативную огибающую сочетаний.', 7.8)
        envelope = self.r.get('envelope')
        assemblies = envelope.get('assemblies') if isinstance(envelope, dict) else []
        for assembly in assemblies or []:
            if not isinstance(assembly, dict):
                continue
            name = assembly.get('name') or assembly.get('id') or 'Ограждение'
            self.add('Ограждение · ' + clean(name), 'envelope', assembly, 'Стационарный 1D скрининг теплопередачи и диффузии. НЕ годовой расчёт влажностного режима.')
            rows = []
            for q in assembly.get('checks') or []:
                if isinstance(q, dict):
                    rows.append(['Проверка · ' + clean(q.get('label', q.get('id'))), STATUSES.get(q.get('status'), clean(q.get('status'))) + '\n' + self.check_value(q) + '\n' + clean(q.get('note', ''))])
            for value in assembly.get('warnings') or []:
                rows.append(['Предупреждение', clean(value)])
            for i, value in enumerate(assembly.get('assumptions') or []):
                rows.append([f'Допущение {i + 1:02d}', clean(value)])
            for value in assembly.get('sources') or []:
                rows.append(['Источник', (clean(value.get('title')) + '\n' + clean(value.get('url'))) if isinstance(value, dict) else clean(value)])
            if rows:
                self.table_pages('Ограждение · ' + clean(name) + ' · проверки и допущения', [('Раздел', .28), ('Данные и границы метода', .72)], rows, 'screen_pass относится только к заданной стационарной паре условий; годовой режим, воздухопроницание и реальные узлы не подтверждены.', 7)
            layers = assembly.get('layers') if isinstance(assembly.get('layers'), list) else []
            interfaces = assembly.get('interfaces') if isinstance(assembly.get('interfaces'), list) else []
            if len(layers) > 9:
                self.table_pages('Ограждение · ' + clean(name) + ' · полный состав слоёв', [('Слой изнутри наружу', .38), ('d, мм', .14), ('λ, Вт/(мК)', .16), ('μ', .14), ('sd, м', .18)], [[v.get('name', v.get('id')), number(optional_number(v.get('thickness')) * 1000 if optional_number(v.get('thickness')) is not None else None, 3), number(v.get('lambda'), 4), number(v.get('mu'), 3), number(v.get('sd'), 4)] for v in layers if isinstance(v, dict)], 'Номинальные свойства из отчёта, не подтверждение свойств конкретного изделия.', 8)
            if len(interfaces) > 9:
                self.table_pages('Ограждение · ' + clean(name) + ' · все межслойные границы', [('Граница', .36), ('x, мм', .13), ('T, °C', .13), ('RH, %', .12), ('pv, Па', .13), ('psat, Па', .13)], [[v.get('name', v.get('id')), number(optional_number(v.get('x')) * 1000 if optional_number(v.get('x')) is not None else None, 3), number(v.get('temperature'), 3), number(v.get('rh'), 2), number(v.get('pVapor'), 2), number(v.get('pSat'), 2)] for v in interfaces if isinstance(v, dict)], 'Давление свободного диффузионного профиля и давление насыщения; масса конденсата не вычисляется.', 8)
        checks = self.r.get('checks') or []
        if self.part_groups:
            # Dedicated envelope/snow/opening sheets already contain these
            # complete checks. Keep one occurrence in the PDF; JSON keeps all.
            checks = [q for q in checks if not (str(q.get('id', '')).startswith('envelope-') and self.r.get('envelope') or str(q.get('id', '')).startswith('snow-') and self.r.get('snowAssessment') or str(q.get('id', '')).startswith('opening-') and self.r.get('floorOpenings'))]
        self.table_pages('Расчётные проверки · общий реестр', [('Проверка', .23), ('Статус', .14), ('Значение / предел', .16), ('Пояснение из движка', .47)], [[q.get('label', q.get('id')), STATUSES.get(q.get('status'), q.get('status', '-')), self.check_value(q), q.get('note', '')] for q in checks], 'Проверки ограждений, снега и обрамления полностью приведены на своих листах. Общий расчёт здания и рабочие узлы не подтверждены.', 7.7)
        if self.part_groups:
            rows = []
            for group in self.part_groups:
                shape = group.get('geometry') or {}
                ends = self.ends(shape.get('cutStart'), shape.get('cutEnd'))
                if shape.get('notches'):
                    ends += '\nВыборок: ' + str(len(shape['notches'])) + '; локальная геометрия в JSON.'
                if (shape.get('shape') or {}).get('type') == 'stairStringer':
                    ends += '\nПильный профиль косоура: контур в JSON; не прямоугольная доска.'
                rows.append([clean(group.get('id')) + '\n', group.get('count'), f'{group.get("b")} × {group.get("h")}', number(group.get('axisLength'), 3) + ' / ' + number(group.get('cutLength'), 3), ends, self.application_summary(group)])
            columns = [('Группа / схема', .12, 'mono'), ('Шт.', .05), ('Сечение, мм', .1), ('Ось / заготовка, м', .12), ('Торцы / выборки', .26), ('Применение · конструкция × количество', .35)]
            self.table_pages('Изготовление · одинаковые детали и применение', columns, rows, 'Одна FG - одна геометрия, включая торцы и выборки. Полные физические ID и точное применение: fabrication-parts.csv / JSON.', 7.5)
            for page in self.pages:
                if page['kind'] == 'table' and page['title'].startswith('Изготовление · одинаковые'):
                    page['kind'] = 'partgroups'
        else:
            schedule = (self.r.get('timber') or {}).get('schedule') or []
            self.table_pages('Спецификация · сводка досок', [('Марка группы', .1, 'mono'), ('Назначение', .27), ('Сечение, мм', .12), ('Длина, м', .1), ('Кол-во', .08), ('Объём, м³', .12), ('Масса, кг', .11), ('Категория', .1)], [[s.get('id'), s.get('name'), f'{s.get("b")} × {s.get("h")}', number(s.get('length'), 3), s.get('count'), number(s.get('volume'), 4), number(s.get('mass'), 2), s.get('category')] for s in schedule], 'Групповая сводка движка. Полные физические ID - во внешнем CSV/JSON.', 7.7)
        erows = [[r.get('name'), r.get('unit'), number(r.get('netQuantity'), 3), number(r.get('quantity'), 3), number(r.get('unitPrice'), 2), number(r.get('total'), 2), r.get('note', '')] for r in self.estimate.get('rows', [])]
        self.table_pages('Смета · материалы и закупка', [('Позиция', .25), ('Ед.', .05), ('Нетто', .08), ('Закупка', .085), (f'Цена, {self.unit_money}', .12), (f'Сумма, {self.unit_money}', .13), ('Основание количества', .285)], erows, 'Цены из отчёта, не коммерческое предложение. Доски закупаются по полной карте 6 м.', 7.5)
        self.add('Смета · итог и состав стоимости', 'estimate')
        self.add('Полная карта раскроя 6 м · правила и сводка', 'cutsummary')
        cards = []
        if self.pattern_groups:
            for pattern in self.pattern_groups:
                if abs(finite(pattern.get('length'), 6) - 6) > 1e-7:
                    raise ValueError('Схема содержит исходную доску иной длины, чем 6 м: ' + clean(pattern.get('id')))
                pieces = pattern.get('pieces') or []
                for offset in range(0, max(1, len(pieces)), 6):
                    cards.append((pattern, offset, pieces[offset:offset + 6]))
            for i in range(0, len(cards), 6):
                self.add('Полная карта раскроя 6 м · повторяемые схемы', 'patterncards', cards[i:i + 6], 'Одна FP-карта на одинаковую раскладку; количество исходных досок указано явно. Точное соответствие stock ID - fabrication-stocks.csv.')
        for stock in ([] if self.pattern_groups else self.cut.get('stocks') or []):
            if abs(finite(stock.get('length'), 6) - 6) > 1e-7:
                raise ValueError('Карта содержит исходную доску иной длины, чем 6 м: ' + clean(stock.get('id')))
            pieces = stock.get('pieces') or []
            # A long stock can occupy continuation cards; no piece IDs are hidden.
            for offset in range(0, max(1, len(pieces)), 8):
                cards.append((stock, offset, pieces[offset:offset + 8]))
        for i in range(0, 0 if self.pattern_groups else len(cards), 4):
            self.add('Полная карта раскроя 6 м', 'cutcards', cards[i:i + 4], 'Все исходные доски по 6 000 мм. Красные промежутки - пропил; серый сегмент - остаток.')
        if self.cut.get('overlength') or self.cut.get('invalid'):
            self.table_pages('Раскрой · неразмещённые и некорректные детали', [('Исходные данные', 1)], [[clean(item)] for item in (self.cut.get('overlength') or []) + (self.cut.get('invalid') or [])], 'Эти детали не включены в подтверждённую закупочную раскладку.')
        # Insert extra contents sheets without circular count dependencies.
        count = math.ceil((len(self.pages) + 2) / 48)
        for _ in range(max(0, count - 1)):
            self.pages.insert(2, {'title': 'Ведомость листов · продолжение', 'kind': 'contents', 'data': None, 'subtitle': ''})

    def check_value(self, q):
        value = q.get('value')
        out = number(value, 4) if isinstance(value, (int, float)) else clean(value) if value is not None else '-'
        if q.get('limit') is not None:
            out += ' / ' + (number(q.get('limit'), 4) if isinstance(q.get('limit'), (int, float)) else clean(q.get('limit')))
        if q.get('unit'):
            out += ' ' + clean(q['unit'])
        if q.get('utilization') is not None:
            out += '\nη = ' + number(q['utilization'], 4)
        return out

    def room_dimensions(self, room):
        poly = [xy(p) for p in room.get('polygon') or []]
        if len(poly) < 3: return '-'
        a, b, d, e = bounds(poly)
        area = abs(sum(p[0] * q[1] - q[0] * p[1] for p, q in zip(poly, poly[1:] + poly[:1]))) / 2
        if abs(area - (d - a) * (e - b)) > 1e-7: return 'Непрямоугольная форма · см. полигон на плане'
        return number(d - a, 3) + ' × ' + number(e - b, 3)

    def application_summary(self, group):
        totals = collections.OrderedDict()
        for app in group.get('applications') or []:
            level = clean(app.get('level'))
            wall_ids = list(dict.fromkeys(([app['wallId']] if app.get('wallId') else []) + list(app.get('wallIds') or [])))
            place = ' / '.join(self.wall_names.get(str(value), clean(value)) for value in wall_ids) if wall_ids else None
            if not place and app.get('rimEdge') is not None:
                place = 'Ребро контура ' + clean(app['rimEdge'])
            if not place:
                for key, label in [('annexId', 'Пристройка'), ('staircaseId', 'Лестница'), ('guardId', 'Ограждение'), ('zoneId', 'Кровля'), ('beamId', 'Балка'), ('voidId', 'Проём'), ('objectId', 'Объект')]:
                    if app.get(key):
                        place = label + ' ' + clean(app[key]); break
            place = place or clean(app.get('name') or app.get('role') or 'Общие детали')
            term = f'Э{level}: {place}'
            totals[term] = totals.get(term, 0) + int(finite(app.get('count')))
        return '; '.join(term + ' ×' + str(count) for term, count in totals.items())

    def compressed_ids(self, values):
        values = list(values or [])
        parsed = [re.fullmatch(r'(.*?)(\d+)', clean(value)) for value in values]
        if not values or not all(parsed) or len(set(m.group(1) for m in parsed)) != 1:
            return ', '.join(clean(value) for value in values)
        prefix, digits = parsed[0].group(1), len(parsed[0].group(2))
        nums = sorted(set(int(m.group(2)) for m in parsed))
        spans, lo, hi = [], nums[0], nums[0]
        for n in nums[1:]:
            if n == hi + 1:
                hi = n
            else:
                spans.append((lo, hi)); lo = hi = n
        spans.append((lo, hi))
        return ', '.join(prefix + str(a).zfill(digits) + ('-' + prefix + str(b).zfill(digits) if b != a else '') for a, b in spans)

    def flatten_fields(self, data, prefix=''):
        labels = {'region': 'Регион', 'country': 'Страна', 'selected': 'Выбран', 'type': 'Тип', 'name': 'Название', 'reason': 'Основание выбора', 'status': 'Статус', 'capacity': 'Несущая способность', 'diameter': 'Диаметр', 'length': 'Длина', 'unitPrice': 'Цена единицы', 'currency': 'Валюта', 'assumptions': 'Допущения', 'alternatives': 'Варианты', 'options': 'Варианты', 'selectedType': 'Выбранный тип', 'note': 'Примечание', 'notes': 'Примечания', 'geotechnicalStatus': 'Геотехнический статус'}
        rows = []
        if isinstance(data, dict):
            for key, value in data.items():
                path = (prefix + ' / ' if prefix else '') + labels.get(key, key)
                rows += self.flatten_fields(value, path)
        elif isinstance(data, list):
            for i, value in enumerate(data):
                rows += self.flatten_fields(value, prefix + f' [{i + 1}]')
        else:
            # Split long prose into continuation rows instead of letting a row cross a page.
            value = clean(data)
            chunks = [value[i:i + 1200] for i in range(0, max(1, len(value)), 1200)]
            rows += [[prefix + (' · продолжение' if i else ''), chunk] for i, chunk in enumerate(chunks)]
        return rows

    def ends(self, a, b):
        return 'A: ' + self.end_label(a) + '; B: ' + self.end_label(b)

    def end_label(self, end):
        end = end or {}
        scheme = end.get('scheme', 'butt')
        labels = {'butt': 'прямой', 'none': 'прямой', 'square': 'прямой', 'miter': 'косой', 'halfLap': 'вполдерева', 'scarf': 'косой замок', 'fishplate': 'накладки'}
        label = labels.get(scheme, scheme)
        if abs(finite(end.get('angle'))) > .001:
            label += ' ' + number(end.get('angle'), 2) + '°'
        if end.get('plane') is not None:
            label += ' пл=' + clean(end.get('plane'))
        if end.get('tiltSign') is not None:
            label += ' знак=' + clean(end.get('tiltSign'))
        if finite(end.get('lapLength')):
            label += ' L=' + number(finite(end['lapLength']) * 1000, 0) + ' мм'
        if end.get('lapSide'):
            label += ' ' + {'top': 'верх', 'bottom': 'низ'}.get(end['lapSide'], clean(end['lapSide']))
        return label

    def frame(self, c, index, page):
        c.setFillColor(colors.white)
        c.rect(0, 0, W, H, fill=1, stroke=0)
        c.setStrokeColor(INK)
        c.setLineWidth(.7)
        c.rect(18, 18, W - 36, H - 36, fill=0, stroke=1)
        text(c, f'КАРКАС ENGINE {self.release}   /   MCP', 34, H - 42, 9, 'Bold', GREEN)
        text(c, page['title'], 34, H - 72, 20, 'Bold')
        if page.get('subtitle'):
            text(c, page['subtitle'], 35, H - 90, 8, color=MUTED, width=W - 90)
        line(c, (30, 78), (W - 30, 78), INK, .7)
        text(c, STATUS, 34, 61, 7.5, 'Bold')
        text(c, 'Крепёж / анкеры / грунт: не подтверждены. Геометрия и частные проверки из цифровой модели.', 34, 46, 7, color=MUTED)
        text(c, f'Проект {self.engine.get("projectId", "-")}   |   ревизия {self.engine.get("revision", "-")}', W - 395, 61, 7.5, 'Bold')
        text(c, f'SHA-256 {clean(self.engine.get("hash", "-"))[:20]}…', W - 395, 46, 7, 'Mono', MUTED)
        line(c, (W - 122, 18), (W - 122, 78), INK, .6)
        text(c, 'ЛИСТ / ЛИСТОВ', W - 110, 61, 6.5, color=MUTED)
        text(c, f'{index + 1:03d} / {len(self.pages):03d}', W - 110, 38, 15, 'Bold')
        c.bookmarkPage(f'page-{index + 1}')
        c.addOutlineEntry(f'{index + 1:03d} {page["title"]}', f'page-{index + 1}', level=0, closed=False)

    def render(self, output):
        c = canvas.Canvas(str(output), pagesize=(W, H), pageCompression=1)
        c.setTitle(clean(self.p.get('name', 'КАРКАС ENGINE')) + ' - КР · расчётная проработка')
        c.setAuthor(f'КАРКАС ENGINE {self.release} / MCP')
        c.setSubject('Расчётный альбом из цифровой модели; не рабочая документация')
        for i, page in enumerate(self.pages):
            self.frame(c, i, page)
            getattr(self, 'draw_' + page['kind'])(c, page.get('data'), i)
            c.showPage()
        c.save()
        return len(self.pages)

    def note(self, c, value, x=42, y=118, width=W - 90, color=MUTED):
        return text(c, value, x, y, 8, color=color, width=width)

    def draw_cover(self, c, data, index):
        x, y = 45, H - 133
        badge(c, 'НЕ РАБОЧАЯ ДОКУМЕНТАЦИЯ', x, y, ORANGE, 9)
        y -= 43
        y = text(c, self.p.get('name', 'Каркасный дом'), x, y, 28, 'Bold', width=540, leading=34) - 20
        site = self.p.get('site') or {}
        text(c, site.get('region') or site.get('location') or 'Площадка: в отчёте не задана', x, y, 11, color=MUTED, width=535)
        y -= 35
        facts = [('Площадь контура по осям', number(self.g.get('area'), 2) + ' м²'), ('Этажи / по осям без проёмов', f'{len(self.levels)} / {number(self.g.get("totalFloorArea"), 2)} м²'), ('Физические детали', f'{len(self.members)} шт.'), ('Доски закупки 6 м', f'{len(self.cut.get("stocks", []))} шт.'), ('Масса древесины', number((self.r.get('timber') or {}).get('mass'), 0) + ' кг'), ('Расчётная вертикальная нагрузка', number((self.r.get('loads') or {}).get('totalDesign'), 3) + ' кН')]
        for label, value in facts:
            text(c, label, x, y, 10, color=MUTED)
            text(c, value, x + 285, y, 11, 'Bold')
            line(c, (x, y - 10), (x + 510, y - 10))
            y -= 34
        self.draw_iso(c, (600, 195, W - 650, H - 330))
        text(c, 'Фактическая геометрия модели', 620, 175, 8, color=MUTED)
        meta_y = 170
        text(c, 'ИДЕНТИФИКАЦИЯ ОТЧЁТА', x, meta_y, 8, 'Bold', GREEN)
        text(c, f'Проект: {self.engine.get("projectId", "-")}   Ревизия: {self.engine.get("revision", "-")}   Схема: {self.engine.get("schemaVersion", "-")}', x, meta_y - 18, 8)
        text(c, f'Создан: {self.engine.get("generatedAt", "-")}   Движок: {self.engine.get("version", "-")}', x, meta_y - 34, 8)
        text(c, 'SHA-256: ' + clean(self.engine.get('hash')), x, meta_y - 51, 7.8, 'Mono')
        basis = site.get('jurisdiction') or site.get('designBasis') or 'Нормативная база в исходном отчёте не задана.'
        text(c, 'Принятые исходные: ' + clean(basis) + ' Полное нормативное соответствие не подтверждено.', 45, 98, 8, color=ORANGE, width=W - 100)

    def draw_iso(self, c, box):
        def project(p):
            a, b, d = xyz(p)
            return (a - d) * .866, b + (a + d) * .32
        segments = [(m, project(m['start']), project(m['end'])) for m in self.members if m.get('start') and m.get('end')]
        fn, scale = transform([p for _, a, b in segments for p in (a, b)], box, 12)
        for m, a, b in sorted(segments, key=lambda s: sum(xyz(s[0]['start'])[::2])):
            line(c, fn(a), fn(b), WOOD_DARK if m.get('category') == 'foundation' else WOOD, max(.45, min(3.3, finite(m.get('b'), 50) / 1000 * scale)))

    def draw_contents(self, c, data, index):
        contents_indices = [i for i, p in enumerate(self.pages) if p['kind'] == 'contents']
        offset = contents_indices.index(index) * 48
        entries = list(enumerate(self.pages))[offset:offset + 48]
        x, top = 43, H - 130
        colw = (W - 115) / 2
        for j, (page_index, page) in enumerate(entries):
            col, row = j // 24, j % 24
            xx, yy = x + col * (colw + 28), top - row * 23
            text(c, f'{page_index + 1:03d}', xx, yy, 9, 'Mono', GREEN)
            text(c, page['title'], xx + 40, yy, 8.5, width=colw - 45)
            line(c, (xx, yy - 8), (xx + colw, yy - 8))
        self.note(c, 'Альбом включает все группы деталей и схемы раскроя с количеством повторений. Полные физические ID и stock ID сохраняются во внешних CSV и JSON.', y=104)

    def draw_assumptions(self, c, data, index):
        columns = [(43, 520), (620, 520)]
        units = ['Координаты в плане X / Y и абсолютные отметки: метры.', 'Размеры чертежей и сечения b × h: миллиметры; размеры по осям, если не подписано иное.', 'Длина оси и заготовочная длина различаются при припусках/нахлёстах.', 'Нагрузки и реакции: кН; поверхностные нагрузки: кН/м²; напряжения: МПа.', 'Прогиб: мм; модуль упругости: МПа; масса: кг; объём: м³.', f'Валюта сметы: {self.unit_money}; цены взяты из исходного отчёта.', 'Лесоматериал: номинальные сечения каталога. Влажность, сортность, фактические размеры и класс материала требуют подтверждения.', 'Масштаб каждой схемы подобран по размеру листа. Для изготовления используйте размеры и ID, не измерение PDF линейкой.']
        limits = ['Это расчётная проработка цифровой модели, НЕ РАБОЧАЯ ДОКУМЕНТАЦИЯ.', 'Геология, геотехнический расчёт, коррозия, морозное пучение и осадки основания не подтверждены.', 'Крепёж, анкеры, опирание, сборка пакетных балок и пространственная работа не проектируются этим рендерером.', 'Узлы показаны геометрически. Нарисованные линии не являются схемой гвоздей или болтов.', 'Лестница показана по метаданным проекта; её конструкция, ограждения, эвакуация и проём требуют отдельного расчёта.', 'Перед изготовлением: проверить размеры на площадке, сорт/влажность древесины, рабочие узлы, опирание и нормативные сочетания.', 'Приоритет имеют числовые данные и статусы исходного JSON. Отсутствующее значение не заменено оценкой.']
        for (x, width), title, lines_ in zip(columns, ('ЕДИНИЦЫ И ПРАВИЛА ЧТЕНИЯ', 'ГРАНИЦЫ РАСЧЁТА'), (units, limits)):
            y = H - 132
            text(c, title, x, y, 11, 'Bold', GREEN)
            y -= 28
            for i, value in enumerate(lines_):
                text(c, f'{i + 1:02d}', x, y, 8, 'Mono', MUTED)
                y = text(c, value, x + 28, y, 9, width=width - 40, leading=13) - 17
        source_notes = list(dict.fromkeys(clean(v) for v in (self.r.get('assumptions') or []) + (self.planning.get('assumptions') or [])))
        if source_notes:
            text(c, 'ИЗ ДОПУЩЕНИЙ ДВИЖКА', 43, 230, 9, 'Bold')
            y = 210
            for value in source_notes[:5]:
                y = text(c, '• ' + value, 43, y, 7.8, width=W - 95) - 5

    def draw_site(self, c, data, index):
        site = self.p.get('site') or {}
        selection = self.report.get('foundationSelection') or self.r.get('foundationSelection') or (self.p.get('foundation') or {}).get('selection') or {}
        y = H - 132
        choice = selection.get('provisionalChoice') or selection if isinstance(selection, dict) else selection
        for title, value in [('ПЛОЩАДКА И НОРМАТИВНЫЕ ИСХОДНЫЕ', site), ('УСЛОВНЫЙ ВЫБОР ФУНДАМЕНТА · НЕ ПОДТВЕРЖДЁН', choice)]:
            text(c, title, 43, y, 11, 'Bold', GREEN)
            y -= 25
            if isinstance(value, dict):
                for key, val in value.items():
                    if isinstance(val, list) and len(val) > 5:
                        val = '; '.join(clean(x) for x in val)
                    yy = text(c, clean(key), 43, y, 8, 'Bold', width=210)
                    yy2 = text(c, clean(val), 270, y, 8, width=W - 320)
                    y = min(yy, yy2) - 11
                    if y < 135:
                        break
            else:
                y = text(c, clean(value), 43, y, 8, width=W - 95) - 20
            y -= 18
        self.note(c, 'Нормативные значения и тип фундамента приняты из задания. Проверка местных условий и подтверждение геологии выполняются проектировщиком.', y=108, color=ORANGE)

    def level_polygon(self, level=None):
        return [xy(p) for p in ((level or {}).get('polygon') or self.g.get('polygon') or [])]

    def platform_polygon(self, level=None):
        level = level or (self.levels[0] if self.levels else {})
        model = next((p for p in (self.r.get('floorPlatform') or {}).get('levels', []) if p.get('index') == level.get('index')), {})
        return [xy(p) for p in (level.get('platformPolygon') or model.get('outerPolygon') or level.get('polygon') or self.g.get('polygon') or [])]

    def wall_section(self, wall):
        profile = next((p for p in self.g.get('wallProfiles', []) if p.get('wallId') == wall.get('id') and p.get('mode') == 'continuous'), {})
        return profile.get('section') or wall.get('section', '50x150')

    def platform_alignment_nodes(self):
        nodes = []
        floor_section = self.section_size((self.p.get('floor') or {}).get('section', '50x200'))
        joist_axis = (self.p.get('floor') or {}).get('axis', 'y')
        for platform in (self.r.get('floorPlatform') or {}).get('levels', []):
            level = next((l for l in self.levels if l.get('index') == platform.get('index')), {})
            edges = [e for e in platform.get('rimSegments', []) if e.get('geometryKnown') and optional_number(e.get('wallDepth')) is not None and all(e.get(key) is not None for key in ('axisStart', 'outerStart', 'centerStart', 'rimInnerStart', 'inwardNormal'))]
            if not edges:
                continue
            # Prefer a section transverse to the joists. The source edge still
            # supplies every alignment dimension and backing reference.
            edge = min(edges, key=lambda e: abs((e.get('u') or {}).get(joist_axis, 0)))
            supports = [s for s in (self.r.get('floorPlatform') or {}).get('supports', []) if s.get('level') == platform.get('index') and s.get('id') in (edge.get('bearing') or {}).get('supportIds', [])]
            normal = xy(edge.get('inwardNormal'))
            origin = xy(edge.get('axisStart'))
            def offset(point):
                px, py = xy(point)
                return ((px - origin[0]) * normal[0] + (py - origin[1]) * normal[1]) * 1000
            support = min(supports, key=lambda s: abs(offset(s.get('a')))) if supports else None
            wall = self.wall_map.get(str(edge.get('wallId')), {})
            wall_b, _ = self.section_size(edge.get('wallSection') or wall.get('section', '50x150'))
            backing_width = finite(support.get('width')) * 1000 if support else None
            backing_center = offset(support.get('a')) if support else None
            backing_wall = self.wall_map.get(str(support.get('id')), {}) if support else {}
            backing_b, backing_h = self.section_size(backing_wall.get('section', '50x150'))
            if platform.get('index') == 1:
                backing_h = self.section_size(self.gr.get('section') or ((self.p.get('foundation') or {}).get('grillage') or {}).get('section', '50x200'))[1]
            base_y = optional_number(platform.get('baseY', level.get('baseY')))
            top_y = optional_number(platform.get('topY'))
            wall_base = optional_number(level.get('wallBaseY'))
            deck = (wall_base - top_y) * 1000 if wall_base is not None and top_y is not None else None
            nodes.append({'level': platform.get('index'), 'edgeId': edge.get('id'), 'wallId': edge.get('wallId'), 'wallDepth': finite(edge.get('wallDepth')) * 1000, 'wallBoard': wall_b,
                          'outer': offset(edge.get('outerStart')), 'rimCenter': offset(edge.get('centerStart')), 'rimInner': offset(edge.get('rimInnerStart')),
                          'rimWidth': finite(edge.get('rimWidth')) * 1000, 'rimAxisOffset': finite(edge.get('outwardOffset')) * 1000,
                          'grillageReveal': optional_number(edge.get('grillageReveal')) * 1000 if optional_number(edge.get('grillageReveal')) is not None else None,
                          'backingWidth': backing_width, 'backingCenter': backing_center, 'backingHeight': backing_h, 'backingBoard': backing_b,
                          'backingKind': support.get('kind') if support else None, 'backingId': support.get('id') if support else None,
                          'floorHeight': (top_y - base_y) * 1000 if top_y is not None and base_y is not None else floor_section[1], 'deckHeight': deck,
                          'baseY': base_y, 'topY': top_y, 'wallBaseY': wall_base, 'bearing': edge.get('bearing') or {}, 'alignmentError': finite((edge.get('alignments') or {}).get('error')) * 1000})
        return nodes

    def draw_stair_plan(self, c, stair, fn, show_note=True):
        points = [xy(p) for p in stair.get('polygon', [])]
        if len(points) < 3:
            return
        polygon(c, [fn(p) for p in points], None, BLUE, 1)
        a, b, d, e = bounds(points)
        direction = clean(stair.get('direction', '')).lower()
        width = optional_number(stair.get('clearFlightWidth', stair.get('width')))
        landing = optional_number(stair.get('landingLength'))
        tread = optional_number(stair.get('tread'))
        risers = int(finite(stair.get('risers')))
        # This orientation is explicit in the final project metadata. Do not
        # turn an unknown U-stair into an invented northbound straight flight.
        east_west_east = 'востока на запад' in direction and 'восточн' in direction
        valid_u = stair.get('kind') == 'u-turn' and east_west_east and width is not None and landing is not None and width > 0 and landing > 0 and d - a > landing and e - b >= 2 * width - 1e-7
        if valid_u:
            inner = a + landing
            lower = [(inner, b), (d, b), (d, b + width), (inner, b + width)]
            upper = [(inner, e - width), (d, e - width), (d, e), (inner, e)]
            turn = [(a, b), (inner, b), (inner, e), (a, e)]
            for piece in (lower, upper, turn):
                polygon(c, [fn(p) for p in piece], colors.HexColor('#f0f6f8'), BLUE, .55)
            run = d - inner
            treads_per_flight = round(run / tread) if tread is not None and tread > 0 else 0
            # Step divisions are shown only when tread/run/total risers agree.
            if treads_per_flight > 0 and abs(treads_per_flight * tread - run) < .002 and 2 * (treads_per_flight + 1) == risers:
                for j in range(1, treads_per_flight):
                    xx = inner + j * tread
                    line(c, fn((xx, b)), fn((xx, b + width)), BLUE, .45)
                    line(c, fn((xx, e - width)), fn((xx, e)), BLUE, .45)
            low_y, high_y, turn_x = b + width / 2, e - width / 2, a + landing / 2
            arrow(c, fn((d - .12, low_y)), fn((turn_x, low_y)), BLUE, .9)
            line(c, fn((turn_x, low_y)), fn((turn_x, high_y)), BLUE, .9)
            arrow(c, fn((turn_x, high_y)), fn((d - .12, high_y)), BLUE, .9)
            text(c, 'ВВЕРХ → ВОСТОЧНАЯ ГАЛЕРЕЯ', *fn((inner + .05, e + .12)), 5.6, 'Bold', BLUE)
            if show_note:
                text(c, f'{risers} подъёмов · h={number(finite(stair.get("riser")) * 1000, 1)} мм · b={number(tread * 1000 if tread is not None else None, 0)} мм', *fn((a + .05, b - .18)), 5.8, color=BLUE)
        else:
            # Explicit polyline geometry is preferred for other orientations.
            route = stair.get('travelPath') or stair.get('path')
            route = [xy(p) for p in route] if isinstance(route, list) else []
            for start, end in zip(route[:-2], route[1:-1]):
                line(c, fn(start), fn(end), BLUE, .8)
            if len(route) >= 2:
                arrow(c, fn(route[-2]), fn(route[-1]), BLUE, .8)
            text(c, 'ЛЕСТНИЦА · КОНТУР', *fn((a + .05, b + .1)), 6, 'Bold', BLUE)

    def draw_plan_base(self, c, level, box, rooms=True, openings=True, axes=True, stair_note=True, wall_faces=False):
        level_index = level.get('index', 1)
        pts = self.level_polygon(level)
        platform_pts = self.platform_polygon(level)
        walls = [w for w in self.p.get('walls', []) if int(w.get('level', w.get('floor', 1))) == int(level_index)]
        axispts = pts + [xy(w[k]) for w in walls for k in ('a', 'b')]
        annexes = [a for a in self.annexes if int(a.get('level', 1)) == int(level_index)]
        allpts = axispts + platform_pts + [xy(p) for a in annexes for p in a.get('polygon') or []]
        fn, scale = transform(allpts, box, 54)
        polygon(c, [fn(p) for p in platform_pts], PAPER, GREEN, .9)
        for annex in annexes:
            ap = [xy(p) for p in annex.get('polygon') or []]
            polygon(c, [fn(p) for p in ap], colors.HexColor('#ebe4d2'), GREEN, .8)
            for m in self.members:
                if m.get('annexId') == annex.get('id') and m.get('category') in ('floor', 'foundation'):
                    line(c, fn(xy(m['start'])), fn(xy(m['end'])), WOOD_DARK, max(.5, finite(m.get('b')) / 1000 * scale))
            for pile in self.r.get('piles') or []:
                if pile.get('annexId') == annex.get('id'):
                    xx, yy = fn(xy(pile)); c.setFillColor(GREEN); c.circle(xx, yy, 2.2, fill=1, stroke=0)
            if ap:
                a, b, d, e = bounds(ap)
                text(c, annex.get('name', annex.get('id')), *fn(((a + d) / 2, (b + e) / 2)), 7.5, 'Bold', GREEN, width=100)
        c.setDash([5, 3]); polygon(c, [fn(p) for p in pts], None, MUTED, .55); c.setDash([])
        if axes:
            # Face-trimmed partition endpoints are not coordinate axes. Their
            # 49/99 mm offsets otherwise create false grids and unreadable dots.
            xs = sorted(set(round(p[0], 4) for p in pts))
            ys = sorted(set(round(p[1], 4) for p in pts))
            a, b, d, e = bounds(axispts)
            for n, xx in enumerate(xs):
                aa, bb = fn((xx, b)), fn((xx, e))
                line(c, (aa[0], aa[1] - 22), (bb[0], bb[1] + 22), LINE, .5, [5, 3])
                c.setFillColor(colors.white); c.setStrokeColor(MUTED); c.circle(aa[0], aa[1] - 30, 9, fill=1, stroke=1)
                text(c, str(n + 1), aa[0] - 2, aa[1] - 33, 7)
            for n, yy in enumerate(ys):
                aa, bb = fn((a, yy)), fn((d, yy))
                line(c, (aa[0] - 22, aa[1]), (bb[0] + 22, bb[1]), LINE, .5, [5, 3])
                c.setFillColor(colors.white); c.setStrokeColor(MUTED); c.circle(aa[0] - 30, aa[1], 9, fill=1, stroke=1)
                text(c, chr(65 + n), aa[0] - 33, aa[1] - 2, 7)
            for x1, x2 in zip(xs, xs[1:]):
                dimension(c, fn((x1, b)), fn((x2, b)), -49, number((x2 - x1) * 1000, 0))
            for y1, y2 in zip(ys, ys[1:]):
                dimension(c, fn((a, y1)), fn((a, y2)), 49, number((y2 - y1) * 1000, 0))
            dimension(c, fn((a, e)), fn((d, e)), 28, number((d - a) * 1000, 0))
            if wall_faces and platform_pts:
                pa, pb, pc, pd = bounds(platform_pts)
                dimension(c, fn((pa, pd)), fn((pc, pd)), 55, number((pc - pa) * 1000, 0) + ' · наружные грани каркаса')
        if rooms:
            for i, room in enumerate(self.planning.get('rooms') or []):
                if int(room.get('level', room.get('floor', 1))) != int(level_index):
                    continue
                rp = [xy(p) for p in room.get('polygon', [])]
                if len(rp) < 3:
                    continue
                polygon(c, [fn(p) for p in rp], colors.Color(.85, .9, .79, alpha=.22), LINE, .4)
                center = (sum(p[0] for p in rp) / len(rp), sum(p[1] for p in rp) / len(rp))
                exclusions = []
                for fixture in room.get('fixtures') or []:
                    fp = [xy(p) for p in fixture.get('polygon') or []]
                    if len(fp) >= 3:
                        exclusions.append(bounds(fp))
                for void in self.p.get('voids') or []:
                    if int(void.get('level', 2)) == int(level_index):
                        exclusions.append(bounds([xy(p) for p in void.get('polygon', [])]))
                stair = self.p.get('staircase') or {}
                if stair and int(level_index) in (int(stair.get('levelFrom', 1)), int(stair.get('levelTo', 2))):
                    exclusions.append(bounds([xy(p) for p in stair.get('polygon', [])]))
                # Label placement only: keep room names off actual voids and
                # the stair drawing, without changing any planning geometry.
                def obstructed(point):
                    return any(a - .1 <= point[0] <= d + .1 and b - .1 <= point[1] <= e + .1 for a, b, d, e in exclusions)
                if obstructed(center):
                    a, b, d, e = bounds(rp)
                    xs = sorted(set([a, d] + [max(a, min(d, v)) for hole in exclusions for v in (hole[0], hole[2])]))
                    ys = sorted(set([b, e] + [max(b, min(e, v)) for hole in exclusions for v in (hole[1], hole[3])]))
                    candidates = []
                    for xa, xb in zip(xs, xs[1:]):
                        for ya, yb in zip(ys, ys[1:]):
                            point = ((xa + xb) / 2, (ya + yb) / 2)
                            if inside_polygon(point, rp) and not obstructed(point):
                                candidates.append(((xb - xa) * (yb - ya), point))
                    if candidates:
                        center = max(candidates)[1]
                supplied = room.get('labelPoint')
                if supplied and inside_polygon(xy(supplied), rp):
                    center = xy(supplied)
                self.draw_room_fixtures(c, room, fn, scale)
                xx, yy = fn(center)
                ra, rb, rd, re_ = bounds(rp)
                label_width = max(75, min(125, (rd - ra) * scale * .8))
                caption = next((room.get(key) for key in ('planLabel', 'shortName', 'name') if isinstance(room.get(key), str) and room.get(key).strip()), f'Помещение {i + 1}')
                label_lines = wrap(caption, label_width, 'Bold', 8)
                label_y = yy + 4
                for label in label_lines:
                    tw = pdfmetrics.stringWidth(label, 'Bold', 8); text(c, label, xx - tw / 2, label_y, 8, 'Bold'); label_y -= 10.3
                area_label = number(room.get('area'), 2) + ' м²'; tw = pdfmetrics.stringWidth(area_label, 'Body', 8)
                text(c, area_label, xx - tw / 2, label_y - 4, 8, color=MUTED)
        for void in self.p.get('voids') or []:
            if int(void.get('level', 2)) != int(level_index):
                continue
            vp = [xy(p) for p in void.get('polygon', [])]
            polygon(c, [fn(p) for p in vp], colors.white, ORANGE, 1)
            a, b, d, e = bounds(vp)
            space = next((s for s in self.spatial.get('doubleHeightSpaces') or [] if s.get('voidId') == void.get('id')), None)
            detailed_stair = (void.get('kind') in ('stair', 'staircase') and bool(self.p.get('staircase'))) or bool(space)
            if space:
                stair = next((s for s in self.spatial.get('staircases') or [] if s.get('id') == space.get('staircaseId')), {})
                stair_min = bounds([xy(p) for p in stair.get('polygon') or []])[0] if stair.get('polygon') else d
                xx, yy = fn(((a + max(a, min(d, stair_min))) / 2, (b + e) / 2))
                text(c, 'ВТОРОЙ СВЕТ', xx - 43, yy + 7, 8, 'Bold', ORANGE)
                text(c, 'единый объём двух этажей', xx - 56, yy - 8, 6.5, color=MUTED)
            if not detailed_stair:
                line(c, fn((a, b)), fn((d, e)), ORANGE, .5, [3, 3])
                line(c, fn((a, e)), fn((d, b)), ORANGE, .5, [3, 3])
                xx, yy = fn(((a + d) / 2, (b + e) / 2))
                text(c, 'ВТОРОЙ СВЕТ' if void.get('kind') == 'doubleHeight' else 'ЛЕСТНИЧНЫЙ ПРОЁМ', xx - 48, yy, 7, 'Bold', ORANGE)
        for wall in walls:
            aa, bb = xy(wall.get('a')), xy(wall.get('b'))
            _, thickness = self.section_size(self.wall_section(wall))
            line(c, fn(aa), fn(bb), INK, max(1, thickness / 1000 * scale) if wall_faces else 1.1, None if wall_faces else [5, 3])
            dx, dy = bb[0] - aa[0], bb[1] - aa[1]
            length = math.hypot(dx, dy)
            if not length:
                continue
            u = dx / length, dy / length
            wall_openings = [op for op in (self.p.get('openings') or []) if str(op.get('wallId')) == str(wall.get('id'))]
            free = subtract_intervals([(0, length)], [(finite(op.get('offset')), finite(op.get('offset')) + finite(op.get('width'))) for op in wall_openings])
            best = max(free, key=lambda span: span[1] - span[0]) if free else (0, length)
            station = (best[0] + best[1]) / 2
            mid = fn((aa[0] + u[0] * station, aa[1] + u[1] * station))
            label = self.wall_names.get(str(wall.get('id')), '')
            label_width = pdfmetrics.stringWidth(label, 'Body', 7)
            # Opening marks stay above/right; wall marks use the opposite
            # side and a solid wall segment, so identical midpoints cannot clash.
            if abs(dx) >= abs(dy):
                text(c, label, mid[0] - label_width / 2, mid[1] - 12, 7, color=GREEN)
            else:
                left_boundary = abs(aa[0] - bounds(axispts)[0]) < 1e-6 and abs(bb[0] - bounds(axispts)[0]) < 1e-6
                label_x = mid[0] + 6 if left_boundary else mid[0] - label_width - 6
                text(c, label, label_x, mid[1] - 3, 7, color=GREEN)
            if not openings:
                continue
            for op in wall_openings:
                start = finite(op.get('offset')); width = finite(op.get('width'))
                op_a = fn((aa[0] + u[0] * start, aa[1] + u[1] * start))
                op_b = fn((aa[0] + u[0] * (start + width), aa[1] + u[1] * (start + width)))
                line(c, op_a, op_b, colors.white, max(2.5, thickness / 1000 * scale + 1) if wall_faces else 3)
                line(c, op_a, op_b, BLUE if op.get('type') != 'door' else ORANGE, 1.1)
                text(c, ('Д' if op.get('type') == 'door' else 'О') + ' ' + number(width * 1000, 0), (op_a[0] + op_b[0]) / 2 + 2, (op_a[1] + op_b[1]) / 2 + 7, 6.5, color=BLUE)
        if wall_faces:
            for wall in walls:
                line(c, fn(xy(wall['a'])), fn(xy(wall['b'])), MUTED, .5, [5, 3])
            self.draw_door_swings(c, level_index, fn)
        stair = self.p.get('staircase') or {}
        actual_stairs = self.spatial.get('staircases') or []
        if actual_stairs:
            self.draw_actual_stair_plan(c, fn, level_index, False)
        elif stair and int(level_index) in (int(stair.get('levelFrom', 1)), int(stair.get('levelTo', 2))):
            self.draw_stair_plan(c, stair, fn, show_note=stair_note)
        return fn, scale

    def draw_room_fixtures(self, c, room, fn, scale):
        grouped = collections.OrderedDict()
        for fixture in room.get('fixtures') or []:
            key = 'stack:' + clean(fixture['stackGroup']) if fixture.get('stackGroup') else 'id:' + clean(fixture.get('id'))
            if key in grouped:
                old = grouped[key]
                if {old.get('kind'), fixture.get('kind')} == {'washer', 'dryer'}:
                    old['label'] = 'СМ + СШ'
                else:
                    old['label'] = clean(old.get('label') or old.get('kind')) + ' + ' + clean(fixture.get('label') or fixture.get('kind'))
            else:
                grouped[key] = dict(fixture)
        for fixture in grouped.values():
            pts = [xy(p) for p in fixture.get('polygon') or []]
            if len(pts) < 3: continue
            i = int(finite(fixture.get('frontEdge'))) % len(pts); a, b = pts[i], pts[(i + 1) % len(pts)]
            width = math.dist(a, b)
            if width < 1e-9: continue
            u = ((b[0] - a[0]) / width, (b[1] - a[1]) / width)
            center = (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
            sign = 1 if (center[0] - a[0]) * -u[1] + (center[1] - a[1]) * u[0] >= 0 else -1
            v = (-u[1] * sign, u[0] * sign); depth = max((p[0] - a[0]) * v[0] + (p[1] - a[1]) * v[1] for p in pts)
            at = lambda x, y: fn((a[0] + x * u[0] + y * v[0], a[1] + x * u[1] + y * v[1]))
            def seg(x1, y1, x2, y2): line(c, at(x1, y1), at(x2, y2), MUTED, .5)
            def rect(x, y, w, h): polygon(c, [at(x, y), at(x + w, y), at(x + w, y + h), at(x, y + h)], None, MUTED, .5)
            def ellipse(x, y, rx, ry):
                xx, yy = at(x, y); c.saveState(); c.translate(xx, yy); c.rotate(math.degrees(math.atan2(u[1], u[0]))); c.setStrokeColor(MUTED); c.setLineWidth(.5); c.ellipse(-rx * scale, -ry * scale, rx * scale, ry * scale, fill=0, stroke=1); c.restoreState()
            kind = fixture.get('kind'); wet = kind in ('shower', 'wc', 'sink', 'washbasin', 'washer', 'dryer')
            polygon(c, [fn(p) for p in pts], colors.HexColor('#e1eceb') if wet else colors.HexColor('#e9e2d5'), MUTED, .7)
            if kind == 'bed':
                rect(width * .07, depth * .08, width * .86, depth * .17); seg(width * .05, depth * .34, width * .95, depth * .34); seg(width * .5, depth * .08, width * .5, depth * .25)
            elif kind == 'sofa':
                rect(width * .08, depth * .67, width * .84, depth * .25); seg(width * .08, depth * .1, width * .08, depth * .65); seg(width * .92, depth * .1, width * .92, depth * .65); seg(width * .5, depth * .1, width * .5, depth * .65)
            elif kind in ('wardrobe', 'kitchenRun'):
                count = max(1, round(width / .6))
                for j in range(1, count): seg(width * j / count, 0, width * j / count, depth)
                if kind == 'wardrobe': seg(0, depth * .13, width, depth * .13)
            elif kind == 'table': rect(width * .08, depth * .08, width * .84, depth * .84)
            elif kind == 'chair': rect(width * .1, depth * (.75 if isinstance(fixture.get('frontEdge'), int) else .1), width * .8, depth * (.2 if isinstance(fixture.get('frontEdge'), int) else .8))
            elif kind == 'hob':
                for x in (.29, .71):
                    for y in (.3, .7): ellipse(width * x, depth * y, min(width, depth) * .12, min(width, depth) * .12)
            elif kind in ('sink', 'washbasin'):
                ellipse(width * .5, depth * .47, width * .34, depth * .32); seg(width * .5, depth * .75, width * .5, depth * .95)
            elif kind == 'wc': rect(width * .08, depth * .73, width * .84, depth * .23); ellipse(width * .5, depth * .39, width * .34, depth * .28)
            elif kind == 'shower': seg(0, 0, width, depth); seg(0, depth, width, 0)
            elif kind in ('washer', 'dryer'): ellipse(width * .5, depth * .52, width * .3, depth * .3); seg(0, depth * .15, width, depth * .15)
            elif kind == 'fridge': seg(0, depth * .25, width, depth * .25); seg(width * .12, depth * .32, width * .12, depth * .7)
            if fixture.get('label'):
                xx, yy = fn(center); label = clean(fixture['label']); tw = pdfmetrics.stringWidth(label, 'Body', 6)
                text(c, label, xx - tw / 2, yy - 2, 6, color=BLUE)

    def draw_door_swings(self, c, level_index, fn):
        seen = set()
        for room in self.planning.get('rooms') or []:
            if int(room.get('level', 1)) != int(level_index): continue
            for swing in room.get('doorSwings') or []:
                oid = swing.get('openingId')
                if oid in seen: continue
                op = next((o for o in self.p.get('openings') or [] if o.get('id') == oid and o.get('type') == 'door'), None)
                wall = self.wall_map.get(str(op.get('wallId'))) if op else None
                if not wall or swing.get('hinge') not in ('start', 'end') or swing.get('normal') not in (-1, 1): continue
                a, b = xy(wall.get('a')), xy(wall.get('b')); length = math.dist(a, b); width = finite(op.get('width')); angle = finite(swing.get('angle'), 90)
                if min(length, width, angle) <= 0 or angle > 180: continue
                u = ((b[0] - a[0]) / length, (b[1] - a[1]) / length); normal = (-u[1] * swing['normal'], u[0] * swing['normal']); end = swing['hinge'] == 'end'
                station = finite(op.get('offset')) + (width if end else 0); hinge = (a[0] + u[0] * station, a[1] + u[1] * station); along = (u[0] * (-1 if end else 1), u[1] * (-1 if end else 1))
                arc = [(hinge[0] + width * (along[0] * math.cos(math.radians(angle * i / 24)) + normal[0] * math.sin(math.radians(angle * i / 24))), hinge[1] + width * (along[1] * math.cos(math.radians(angle * i / 24)) + normal[1] * math.sin(math.radians(angle * i / 24)))) for i in range(25)]
                for x, y in zip(arc, arc[1:]): line(c, fn(x), fn(y), GREEN, .55)
                line(c, fn(hinge), fn(arc[-1]), GREEN, .9); seen.add(oid)

    def draw_actual_stair_plan(self, c, fn, level_index=None, note=False):
        """Physical tread/landing polygons and guard axes, not invented step divisions."""
        stairs = [s for s in self.spatial.get('staircases') or [] if level_index is None or int(level_index) in (int(s.get('levelFrom', 1)), int(s.get('levelTo', 2)))]
        source_ids = {str(v) for stair in stairs for v in stair.get('boardIds') or []}
        for surface in self.spatial.get('surfaces') or []:
            if surface.get('kind') not in ('stairTread', 'stairLanding'):
                continue
            ids = set(map(str, surface.get('sourceBoardIds') or []))
            if ids and not ids.intersection(source_ids):
                continue
            points = surface.get('pointsXYZ') or surface.get('points') or []
            polygon(c, [fn(xy(p)) for p in points], WOOD, WOOD_DARK, .45)
        for guard in self.spatial.get('guards') or []:
            if guard.get('kind') == 'levelGuard' and level_index is not None and int(guard.get('level', 2)) != int(level_index):
                continue
            line(c, fn(xy(guard.get('start'))), fn(xy(guard.get('end'))), GREEN, 1.6)
        for stair in stairs:
            flights = stair.get('flights') or []
            for flight in flights:
                poly = [xy(p) for p in flight.get('polygon') or []]
                if not poly:
                    continue
                a, b, d, e = bounds(poly)
                direction = xyz(flight.get('direction'))
                center = ((a + d) / 2, (b + e) / 2)
                arrow(c, fn((center[0] - direction[0] * .65, center[1] - direction[2] * .65)), fn((center[0] + direction[0] * .65, center[1] + direction[2] * .65)), BLUE, 1.1)
            if note and stair.get('polygon'):
                a, b, d, e = bounds([xy(p) for p in stair['polygon']])
                text(c, str(stair.get('risers', '-')) + ' подъёмов · h=' + number(finite(stair.get('riser')) * 1000, 1) + ' мм', *fn((a, b - .25)), 6.5, color=BLUE)

    def projected_member(self, m, project):
        """Projection of the real blank/profile; no connection or strength assumptions."""
        a, b = xyz(m.get('start')), xyz(m.get('end'))
        delta = tuple(b[i] - a[i] for i in range(3)); length = math.sqrt(sum(v * v for v in delta))
        if length < 1e-9:
            return []
        u = tuple(v / length for v in delta)
        raw = xyz(m.get('crossAxis') or [1, 0, 0]); dot = sum(raw[i] * u[i] for i in range(3))
        cross = tuple(raw[i] - dot * u[i] for i in range(3)); norm = math.sqrt(sum(v * v for v in cross))
        if norm < 1e-9:
            cross = (u[2], 0, -u[0]); norm = math.sqrt(sum(v * v for v in cross))
        if norm < 1e-9:
            cross, norm = (1, 0, 0), 1
        cross = tuple(v / norm for v in cross)
        depth = (cross[1] * u[2] - cross[2] * u[1], cross[2] * u[0] - cross[0] * u[2], cross[0] * u[1] - cross[1] * u[0])
        center = tuple((a[i] + b[i]) / 2 for i in range(3))
        shape = m.get('shape') or {}
        profile = shape.get('points') if shape.get('type') in ('stairStringer', 'rippedBoard') else None
        if profile:
            return [project(tuple(center[i] + u[i] * finite(p[0]) + depth[i] * finite(p[1]) for i in range(3))) for p in profile]
        # Convex hull of the actual rectangular section's eight projected corners.
        points = sorted(set(project(tuple(center[i] + u[i] * s + depth[i] * h + cross[i] * w for i in range(3))) for s in (-length / 2, length / 2) for h in (-finite(m.get('h')) / 2000, finite(m.get('h')) / 2000) for w in (-finite(m.get('b')) / 2000, finite(m.get('b')) / 2000)))
        if len(points) < 3:
            return points
        def turn(a, b, c):
            return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
        lower, upper = [], []
        for p in points:
            while len(lower) > 1 and turn(lower[-2], lower[-1], p) <= 0:
                lower.pop()
            lower.append(p)
        for p in reversed(points):
            while len(upper) > 1 and turn(upper[-2], upper[-1], p) <= 0:
                upper.pop()
            upper.append(p)
        return lower[:-1] + upper[:-1]

    def draw_floorplan(self, c, level, index):
        self.draw_plan_base(c, level, (45, 145, 800, H - 265), wall_faces=True)
        x, y = 885, H - 138
        text(c, level.get('name', f'Этаж {level.get("index")}'), x, y, 14, 'Bold')
        y -= 30
        pa, pb, pc, pd = bounds(self.platform_polygon(level))
        facts = [('Каркас · наружные грани', number(pc - pa, 3) + ' × ' + number(pd - pb, 3) + ' м'), ('Контур по осям', number(level.get('area'), 2) + ' м²'), ('По осям без проёмов', number(level.get('netFloorArea'), 2) + ' м²')]
        if level.get('platformNetArea') is not None:
            facts.append(('Платформа без проёмов', number(level.get('platformNetArea'), 2) + ' м²'))
        facts += [('Проёмы перекрытия', number(level.get('voidArea'), 2) + ' м²'), ('Низ платформы', '+' + number(level.get('platformBase'), 3)), ('Основание стены', '+' + number(level.get('wallBaseY'), 3)), ('Номинальный верх', '+' + number(level.get('topY'), 3))]
        for label, value in facts:
            text(c, label, x, y, 8, color=MUTED)
            text(c, value, x, y - 17, 12, 'Bold')
            y -= 51
        if not self.planning.get('rooms'):
            text(c, 'Разбивка помещений отсутствует в исходном отчёте.', x, y - 6, 8, color=ORANGE, width=245)
        if int(self.p.get('floors', 1)) > 1 and not self.p.get('staircase'):
            text(c, 'Геометрия лестницы в отчёте не задана.', x, y - 48, 8, color=ORANGE, width=245)
        stair = next((s for s in self.spatial.get('staircases') or [] if int(level.get('index', 1)) in (int(s.get('levelFrom', 1)), int(s.get('levelTo', 2)))), None)
        if stair:
            text(c, 'ЛЕСТНИЦА ПО МОДЕЛИ', x, y - 4, 8, 'Bold', BLUE)
            text(c, str(stair.get('risers')) + ' подъёмов\nh=' + number(finite(stair.get('riser')) * 1000, 1) + ' мм · b=' + number(finite(stair.get('tread')) * 1000, 0) + ' мм', x, y - 25, 8.3, color=BLUE, width=245)
        self.note(c, 'О - окно; Д - дверь. Размеры между осями стен; платформа по наружным граням. Отметки относительно единого нуля модели. Лестница требует отдельного расчёта.', y=103)

    def draw_piles(self, c, data, index):
        level = self.levels[0] if self.levels else {}
        fn, scale = self.draw_plan_base(c, level, (40, 135, 850, H - 245), rooms=False, openings=False)
        for beam in self.gr.get('beams') or []:
            line(c, fn(xy(beam['a'])), fn(xy(beam['b'])), WOOD_DARK, 2)
        piles = self.gr.get('piles') or self.r.get('piles') or []
        for p in piles:
            xx, yy = fn(xy(p))
            c.setFillColor(colors.white); c.setStrokeColor(INK); c.circle(xx, yy, 7, fill=1, stroke=1)
            line(c, (xx - 3, yy), (xx + 3, yy), INK); line(c, (xx, yy - 3), (xx, yy + 3), INK)
            text(c, p.get('id'), xx + 9, yy + 10, 6.5, 'Mono')
            text(c, number(p.get('reaction'), 2) + ' кН', xx + 9, yy - 1, 6.5, color=GREEN)
        foundation = self.r.get('foundation') or {}
        x, y = 930, H - 145
        text(c, 'РЕАКЦИИ И ОПОРЫ', x, y, 10, 'Bold', GREEN)
        y -= 30
        for label, value in [('Свай', str(len(piles))), ('Сумма Fd', number(foundation.get('reactionSum'), 3) + ' кН'), ('Макс. реакция', number(foundation.get('maxReaction'), 3) + ' кН'), ('Заданная способность', number((self.p.get('foundation') or {}).get('capacity'), 2) + ' кН'), ('Оголовок', number(self.gr.get('capSize'), 0) + ' мм')]:
            text(c, label, x, y, 8, color=MUTED); text(c, value, x, y - 18, 13, 'Bold'); y -= 56
        text(c, 'Реакции рассчитаны по ростверку. Принятая способность сваи требует геологии, проверки выбранной системы и погружения.', x, y - 8, 8.5, color=ORANGE, width=205)

    def draw_grillage(self, c, data, index):
        level = self.levels[0] if self.levels else {}
        fn, scale = self.draw_plan_base(c, level, (40, 135, 770, H - 250), rooms=False, openings=False)
        for beam in self.gr.get('beams') or []:
            line(c, fn(xy(beam['a'])), fn(xy(beam['b'])), WOOD, max(3, finite(beam.get('width'), .15) * scale))
            aa, bb = fn(xy(beam['a'])), fn(xy(beam['b']))
            text(c, beam.get('id'), (aa[0] + bb[0]) / 2 + 4, (aa[1] + bb[1]) / 2 + 7, 7.5, 'Mono', WOOD_DARK)
        for p in self.gr.get('piles') or []:
            xx, yy = fn(xy(p)); c.setFillColor(INK); c.circle(xx, yy, 3, fill=1, stroke=0)
        x, y = 865, H - 145
        text(c, 'ПАКЕТ НА РЕБРО', x, y, 12, 'Bold', GREEN)
        y -= 28
        text(c, f'{self.gr.get("plies", "-")} × {self.gr.get("section", "-")}', x, y, 16, 'Bold')
        section = (self.p.get('foundation') or {}).get('grillage') or {}
        b, h = self.section_size(section.get('section', '50x200'))
        plies = int(finite(self.gr.get('plies'), 3))
        scale2 = .65
        base = 370
        for j in range(plies):
            c.setFillColor(WOOD); c.setStrokeColor(WOOD_DARK); c.rect(x + j * b * scale2, base, b * scale2, h * scale2, fill=1, stroke=1)
        line(c, (x - 18, base - 10), (x + plies * b * scale2 + 18, base - 10), INK, 4)
        text(c, 'Оголовок', x - 10, base - 30, 8)
        dimension(c, (x, base), (x + plies * b * scale2, base), -48, f'{plies} × {number(b, 0)} = {number(plies * b, 0)} мм')
        text(c, 'УРОВНИ', x, 270, 9, 'Bold', GREEN)
        text(c, 'Оголовок / низ пакета  +' + number(self.gr.get('pileHeadY'), 3), x, 247, 9)
        text(c, 'Верх ростверка             +' + number(self.gr.get('topY'), 3), x, 228, 9)
        text(c, 'Совместная работа слоёв и закрепление на оголовке не подтверждены.', x, 190, 8.5, color=ORANGE, width=245)

    def draw_platformdetails(self, c, nodes, index):
        for i, node in enumerate(nodes or []):
            x, y, w, h = 43 + i * 567, 165, 535, 540
            c.setStrokeColor(LINE); c.rect(x, y, w, h, fill=0, stroke=1)
            title = '1 · Над ростверком' if node['level'] == 1 else f'{node["level"]} · Над нижней стеной'
            text(c, title, x + 14, y + h - 22, 12, 'Bold', GREEN)
            text(c, self.wall_names.get(str(node.get('wallId')), clean(node.get('wallId'))) + ' · ' + clean(node.get('edgeId')), x + 14, y + h - 42, 7.5, color=MUTED)
            outer, inner = node['outer'], node['rimInner']
            wall_inner = outer + node['wallDepth']
            floor_h = finite(node.get('floorHeight'))
            deck_h = max(0, finite(node.get('deckHeight')))
            deck_top = floor_h + deck_h
            backing_h = node['backingHeight'] if node['level'] == 1 else 260
            bwidth = optional_number(node.get('backingWidth'))
            bcenter = finite(node.get('backingCenter'))
            left = min(outer - 80, bcenter - (bwidth or node['wallDepth']) / 2 - 40)
            right = max(wall_inner + 240, 360)
            fn, scale = transform([(left, -backing_h - 65), (right, deck_top + 350)], (x + 14, y + 92, w - 28, h - 157), 10)
            if bwidth is not None:
                blo, bhi = bcenter - bwidth / 2, bcenter + bwidth / 2
                polygon(c, [fn((blo, -backing_h)), fn((bhi, -backing_h)), fn((bhi, 0)), fn((blo, 0))], WOOD if node['level'] == 1 else colors.HexColor('#eee4d2'), WOOD_DARK, .8)
                if node['level'] == 1:
                    plies = max(1, int(finite(self.gr.get('plies'), 1)))
                    for j in range(1, plies):
                        xx = blo + bwidth * j / plies
                        line(c, fn((xx, -backing_h)), fn((xx, 0)), WOOD_DARK, .5)
                else:
                    line(c, fn((blo, -node['backingBoard'])), fn((bhi, -node['backingBoard'])), WOOD_DARK, .8)
                    # Lower frame is an envelope, not a claim of solid corner timber.
                    for j in range(3):
                        yy = -backing_h + 35 + j * 60
                        line(c, fn((blo, yy)), fn((bhi, yy + 35)), LINE, .5)
                dimension(c, fn((blo, -backing_h)), fn((bhi, -backing_h)), -19, number(bwidth, 0) + ' мм')
            polygon(c, [fn((inner, 0)), fn((right - 35, 0)), fn((right - 35, floor_h)), fn((inner, floor_h))], colors.HexColor('#e7d9bf'), WOOD_DARK, .7)
            polygon(c, [fn((outer, 0)), fn((inner, 0)), fn((inner, floor_h)), fn((outer, floor_h))], LIME, GREEN, 1)
            polygon(c, [fn((outer, floor_h)), fn((right - 35, floor_h)), fn((right - 35, deck_top)), fn((outer, deck_top))], colors.HexColor('#b7caa0'), GREEN, .6)
            polygon(c, [fn((outer, deck_top)), fn((wall_inner, deck_top)), fn((wall_inner, deck_top + 290)), fn((outer, deck_top + 290))], colors.HexColor('#ead5b1'), WOOD_DARK, .8)
            line(c, fn((outer, deck_top + node['wallBoard'])), fn((wall_inner, deck_top + node['wallBoard'])), WOOD_DARK, .8)
            line(c, fn((0, -backing_h - 20)), fn((0, deck_top + 325)), MUTED, .65, [5, 3])
            line(c, fn((node['rimCenter'], -30)), fn((node['rimCenter'], floor_h + 15)), BLUE, .65, [3, 2])
            line(c, fn((outer, -15)), fn((outer, deck_top + 300)), GREEN, 1.2)
            dimension(c, fn((outer, deck_top + 290)), fn((wall_inner, deck_top + 290)), 17, number(node['wallDepth'], 0) + ' мм · каркас')
            dimension(c, fn((outer, floor_h * .58)), fn((inner, floor_h * .58)), 0, number(node['rimWidth'], 0))
            dimension(c, fn((node['rimCenter'], -backing_h * .55)), fn((0, -backing_h * .55)), 0, number(node['rimAxisOffset'], 0))
            if node.get('grillageReveal') is not None and bwidth is not None:
                dimension(c, fn((bcenter - bwidth / 2, 0)), fn((outer, 0)), 15, number(node['grillageReveal'], 0))
            axis_point = fn((0, deck_top + 325))
            text(c, 'Ось стены', axis_point[0] + 4, axis_point[1] + 17, 7, color=MUTED)
            label_x = x + w - 148
            label_y = fn((right - 30, floor_h * .45))[1]
            text(c, 'rim ' + number(node['rimWidth'], 0) + ' × ' + number(floor_h, 0) + ' мм\nЛага: фрагмент\nНастил: +' + number(node.get('wallBaseY'), 3), label_x, label_y, 7.5, width=130)
            text(c, 'Опорный верх +' + number(node.get('baseY'), 3), x + 14, y + 113, 7.5, 'Bold')
            text(c, 'Совпадают наружные грани каркаса, платформы и rim.\nОсь rim смещена кнаружи на ' + number(node['rimAxisOffset'], 0) + ' мм. Надбалочный слой по отметкам: ' + number(node.get('deckHeight'), 0) + ' мм.', x + 14, y + 79, 8, width=w - 28)
            if node.get('grillageReveal') is not None:
                text(c, 'Выпуск ростверка ' + number(node['grillageReveal'], 0) + ' мм соответствует разнице ширин пакета и каркаса.', x + 14, y + 32, 8, 'Bold', ORANGE, width=w - 28)
            else:
                text(c, 'Нижняя стена показана огибающей; угловой контакт не подтверждён.', x + 14, y + 32, 8, 'Bold', ORANGE, width=w - 28)
        self.note(c, 'Проверена геометрия граней и полосы опирания. Смятие, поперечный момент, крепёж, угловые контакты и влагозащита не рассчитаны. Наружные слои фасада здесь не показаны.', y=124, color=ORANGE)
        self.note(c, 'Смещение rim и выпуск ростверка читаются от указанных осей/граней. Состав настила - по листам ограждений; капельник и мембраны требуют рабочего узла.', y=105)

    def section_size(self, value):
        if isinstance(value, dict):
            return finite(value.get('b'), 50), finite(value.get('h'), 200)
        parts = clean(value).lower().replace('×', 'x').replace(' ', '').split('x')
        return (finite(parts[0], 50), finite(parts[1], 200)) if len(parts) > 1 else (50, 200)

    def draw_beamcards(self, c, beams, index):
        for j, beam in enumerate(beams or []):
            x, y, w, h = 43, H - 310 - j * 195, W - 86, 175
            c.setStrokeColor(LINE); c.setFillColor(PAPER); c.roundRect(x, y, w, h, 6, fill=1, stroke=1)
            text(c, f'{beam.get("id")}   /   {number(beam.get("length"), 3)} м   /   {beam.get("plies", self.gr.get("plies", "-"))} слоя', x + 14, y + h - 22, 11, 'Bold')
            bx, bw = x + 100, w - 130
            length = max(.001, finite(beam.get('length')))
            instances = [m for m in self.gr.get('instances', []) if m.get('beamId') == beam.get('id')]
            plies = sorted(set(int(m.get('plyIndex', 0)) for m in instances))
            ply_step = min(30, 72 / max(1, len(plies) - 1))
            bar_height = min(18, max(7, ply_step - 4))
            for k, ply in enumerate(plies):
                yy = y + h - 52 - k * ply_step
                text(c, f'Слой {ply + 1}', x + 15, yy + 3, 8, 'Bold')
                for m in sorted((m for m in instances if int(m.get('plyIndex', 0)) == ply), key=lambda m: finite(m.get('stationStart'))):
                    s, e = finite(m.get('stationStart')), finite(m.get('stationEnd'))
                    sx, ex = bx + s / length * bw, bx + e / length * bw
                    c.setFillColor(WOOD if ply % 2 == 0 else LIME); c.setStrokeColor(WOOD_DARK); c.rect(sx, yy - 3, max(.2, ex - sx), bar_height, fill=1, stroke=1)
                    label = self.marks.get(str(m.get('id')), clean(m.get('id')))
                    text(c, label + ' · ' + number(m.get('cutLength', m.get('length')), 3) + ' м', sx + 4, yy + (3 if bar_height >= 15 else -.5), 7 if bar_height >= 15 else 6.1, width=max(10, ex - sx - 7))
                for station in beam.get('stations') or []:
                    xx = bx + finite(station.get('station')) / length * bw
                    line(c, (xx, yy - 8), (xx, yy + 19), MUTED, .5, [2, 2])
            for station in beam.get('stations') or []:
                xx = bx + finite(station.get('station')) / length * bw
                polygon(c, [(xx - 4, y + 19), (xx + 4, y + 19), (xx, y + 25)], INK, None)
                text(c, station.get('pileId', '-'), xx - 16, y + 7, 6, 'Mono')
            joints = [q for q in self.gr.get('joints', []) if q.get('beamId') == beam.get('id')]
            text(c, f'Фактические стыки: {len(joints)}; опоры и станции показаны пунктиром. Полные ID досок - во внешнем CSV/JSON.', x + 14, y + 39, 7, color=MUTED)

    def draw_floorframing(self, c, level, index):
        fn, scale = self.draw_plan_base(c, level, (40, 135, 870, H - 245), rooms=False, openings=False, stair_note=False)
        platform = self.r.get('floorPlatform') or {}
        bearing_lines = [support for support in (platform.get('supports') or []) if int(support.get('level', 1)) == int(level.get('index', 1))]
        spans = [span for span in (platform.get('spans') or []) if int(span.get('level', 1)) == int(level.get('index', 1))]
        for support in bearing_lines:
            if support.get('a') is not None and support.get('b') is not None:
                line(c, fn(xy(support['a'])), fn(xy(support['b'])), SUPPORT, 2, [6, 3])
        members = [m for m in self.members if m.get('category') == 'floor' and int(m.get('floor', m.get('level', 1))) == int(level.get('index', 1))]
        labelled_groups = set()
        group_label_boxes = []
        for j, m in enumerate(members):
            if not m.get('start') or not m.get('end'):
                continue
            a, b = fn(xy(m['start'])), fn(xy(m['end']))
            is_opening = bool(m.get('voidId')) or clean(m.get('role')).startswith('opening')
            color = ORANGE if is_opening or 'void' in clean(m.get('role')).lower() or 'header' in clean(m.get('role')).lower() else WOOD_DARK
            if m.get('role') == 'rimJoist':
                color = GREEN
            elif m.get('role') == 'floorBlocking':
                color = BLUE
            line(c, a, b, color, max(1.2, min(5, finite(m.get('b'), 50) / 1000 * scale)))
            group_id = self.marks.get(str(m.get('id')), str(m.get('id')))
            label_key = (group_id, m.get('role'))
            if label_key not in labelled_groups:
                labelled_groups.add(label_key)
                xx, yy = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
                label_x, label_y = xx + 3, yy + 3
                if is_opening:
                    void = next((v for v in self.p.get('voids', []) if v.get('id') == m.get('voidId')), {})
                    poly = [xy(p) for p in void.get('polygon', [])]
                    if poly:
                        low_x, low_y, high_x, high_y = bounds(poly)
                        center = fn(((low_x + high_x) / 2, (low_y + high_y) / 2))
                        if abs(b[1] - a[1]) >= abs(b[0] - a[0]):
                            label_x = xx - pdfmetrics.stringWidth(group_id, 'Mono', 6) - 5 if xx <= center[0] else xx + 5
                        else:
                            label_y = yy - 11 if yy <= center[1] else yy + 7
                label_width = pdfmetrics.stringWidth(group_id, 'Mono', 6)
                if abs(b[1] - a[1]) >= abs(b[0] - a[0]):
                    candidates = [(label_x, label_y + delta) for delta in (0, 11, -11, 22, -22)]
                else:
                    candidates = [(label_x + delta, label_y) for delta in (0, 25, -25, 50, -50)]
                for cx, cy in candidates:
                    rect = (cx - 1, cy - 2, cx + label_width + 1, cy + 7)
                    if not any(rect[0] < old[2] + 2 and rect[2] + 2 > old[0] and rect[1] < old[3] + 2 and rect[3] + 2 > old[1] for old in group_label_boxes):
                        label_x, label_y = cx, cy
                        group_label_boxes.append(rect)
                        break
                text(c, group_id, label_x, label_y, 6, 'Mono', color)
        for span in spans:
            for endpoint in ('supportStart', 'supportEnd'):
                support = span.get(endpoint) or {}
                if support.get('point') is not None:
                    xx, yy = fn(xy(support['point']))
                    c.setFillColor(SUPPORT); c.circle(xx, yy, 1.8, fill=1, stroke=0)
        marked = set()
        labelled_support_sources = set()
        for member in (self.r.get('floorOpenings') or {}).get('instances', []):
            if int(member.get('floor', member.get('level', 1))) != int(level.get('index', 1)):
                continue
            for support in member.get('supports') or []:
                position = support.get('position') or support.get('point')
                if position is None:
                    continue
                point = xy(position)
                key = (round(point[0], 5), round(point[1], 5), support.get('wallId') or support.get('memberId'))
                if key in marked:
                    continue
                marked.add(key)
                xx, yy = fn(point)
                c.setFillColor(colors.white); c.setStrokeColor(BLUE); c.circle(xx, yy, 3.5, fill=1, stroke=1)
                label = self.wall_names.get(str(support.get('wallId'))) or self.marks.get(str(support.get('memberId')), '')
                source = support.get('sourceId') or support.get('wallId') or support.get('memberId')
                already_marked_group = label.startswith('FG') and any(key[0] == label for key in labelled_groups)
                if source not in labelled_support_sources and not already_marked_group:
                    labelled_support_sources.add(source)
                    text(c, label, xx + 5, yy - 9, 5.8, color=BLUE)
        x, y = 950, H - 145
        text(c, 'ПЕРЕКРЫТИЕ', x, y, 11, 'Bold', GREEN); y -= 30
        grouped = collections.Counter((m.get('b'), m.get('h'), m.get('role')) for m in members)
        for (b, h, role), count in grouped.items():
            y = text(c, f'{ROLE.get(role, role)}\n{b} × {h} мм · {count} шт.', x, y, 8.5, width=190) - 18
        stair = next(iter(self.spatial.get('staircases') or []), None) or self.p.get('staircase') or {}
        if stair and int(level.get('index', 1)) in (int(stair.get('levelFrom', 1)), int(stair.get('levelTo', 2))):
            y = text(c, f'Лестница: {clean(stair.get("risers", "-"))} подъёмов; h={number(finite(stair.get("riser")) * 1000, 1)} мм; проступь {number(finite(stair.get("tread")) * 1000, 0)} мм.', x, y - 5, 7.5, color=BLUE, width=190) - 18
        y = min(y - 10, 280)
        for label, color in [('Обвязка перекрытия', GREEN), ('Поперечные распорки', BLUE), ('Лаги', WOOD_DARK), ('Обрамление проёмов', ORANGE)]:
            line(c, (x, y + 3), (x + 18, y + 3), color, 3)
            text(c, label, x + 25, y, 7.5, color=color); y -= 20
        if platform:
            line(c, (x, y + 3), (x + 18, y + 3), SUPPORT, 2, [4, 2])
            text(c, 'Несущие линии: ' + str(len(bearing_lines)), x + 25, y, 7.5, color=SUPPORT); y -= 20
            text(c, 'Пролёты по модели: ' + str(len(spans)) + '. Опоры обрамления: ' + str(len(marked)) + ' мест. Показана геометрия опор; соединения и передача усилий подтверждаются отдельно.', x, y - 8, 7.5, color=MUTED, width=190)
        else:
            text(c, 'Опорная модель платформы не передана. Опоры обрамления: ' + str(len(marked)) + ' мест; соединения требуют подтверждения.', x, y - 8, 7.5, color=MUTED, width=190)

    def wall_members(self, wall):
        wid = str(wall.get('id'))
        return [m for m in self.members if str(m.get('wallId')) == wid or wid in [str(x) for x in m.get('wallIds', [])]]

    def draw_wallframes(self, c, walls, index):
        for i, wall in enumerate(walls or []):
            x, y, w, h = 43, H - 420 - i * 325, W - 86, 305
            members = self.wall_members(wall)
            a, b = xy(wall.get('a')), xy(wall.get('b'))
            length = math.hypot(b[0] - a[0], b[1] - a[1])
            ux, uy = ((b[0] - a[0]) / max(length, .001), (b[1] - a[1]) / max(length, .001))
            def local(p):
                xx, yy, zz = xyz(p)
                return (xx - a[0]) * ux + (zz - a[1]) * uy, yy
            pts = [local(m[k]) for m in members for k in ('start', 'end') if m.get(k)]
            level = next((v for v in self.levels if int(v.get('index', 1)) == int(wall.get('level', 1))), {})
            base = finite(level.get('wallBaseY'))
            pts += [(0, base), (length, base)]
            fn, scale = transform(pts, (x + 35, y + 32, w - 310, h - 62), 20)
            c.setStrokeColor(LINE); c.rect(x, y, w, h, fill=0, stroke=1)
            title = f'{self.wall_names.get(str(wall.get("id")), "Стена")} · этаж {wall.get("level", 1)} · {number(length * 1000, 0)} мм'
            text(c, title, x + 13, y + h - 20, 11, 'Bold')
            text(c, wall.get('id'), x + w - 275, y + h - 20, 7, 'Mono', MUTED)
            for op in self.p.get('openings') or []:
                if str(op.get('wallId')) != str(wall.get('id')):
                    continue
                s = finite(op.get('offset')); sill = finite(op.get('sill')); oh = finite(op.get('height')); ow = finite(op.get('width'))
                polygon(c, [fn((s, base + sill)), fn((s + ow, base + sill)), fn((s + ow, base + sill + oh)), fn((s, base + sill + oh))], colors.HexColor('#edf5f7'), BLUE, .6)
                aa, bb = fn((s, base + sill + oh / 2)), fn((s + ow, base + sill + oh / 2))
                text(c, f'{number(ow * 1000, 0)} × {number(oh * 1000, 0)}', (aa[0] + bb[0]) / 2 - 27, aa[1], 6.5, color=BLUE)
            for j, m in enumerate(members):
                if not m.get('start') or not m.get('end'):
                    continue
                aa, bb = fn(local(m['start'])), fn(local(m['end']))
                is_brace = m.get('role') == 'letInBrace'
                thickness = finite(m.get('h') if is_brace else m.get('b'), 50) / 1000 * scale
                line(c, aa, bb, GREEN if is_brace else WOOD_DARK, max(.8, min(7, thickness)))
                # Labels are spread over two bands; full detail IDs remain in registry.
                if j % max(1, math.ceil(len(members) / 20)) == 0:
                    mx, my = (aa[0] + bb[0]) / 2, (aa[1] + bb[1]) / 2
                    text(c, self.marks.get(str(m.get('id')), ''), mx + 3, my + (5 if j % 2 else -8), 5.8, 'Mono', GREEN if is_brace else INK)
                for notch in m.get('notches') or []:
                    poly = [local(p) for p in notch.get('polygon', [])]
                    if len(poly) >= 3:
                        polygon(c, [fn(p) for p in poly], None, RED, .6)
            low, high = bounds(pts)[1], bounds(pts)[3]
            dimension(c, fn((0, low)), fn((length, low)), -17, number(length * 1000, 0))
            dimension(c, fn((0, low)), fn((0, high)), 20, number((high - low) * 1000, 0))
            sx, sy = x + w - 270, y + h - 47
            text(c, f'Низ +{number(low, 3)}  /  верх +{number(high, 3)}', sx, sy, 8, 'Bold')
            sy -= 23
            profile = next((p for p in self.g.get('wallProfiles', []) if str(p.get('wallId')) == str(wall.get('id'))), {})
            if profile:
                mode = {'continuous': 'Цельные стойки', 'stacked': 'Составная стена', 'blocked': 'Не подобрано'}.get(profile.get('mode'), clean(profile.get('mode')))
                sy = text(c, mode + ' · макс. стойка ' + number(profile.get('studMaxLength'), 3) + ' м', sx, sy, 7.5, 'Bold', GREEN, width=250) - 8
            groups = collections.Counter((m.get('b'), m.get('h'), m.get('role')) for m in members)
            for (mb, mh, role), count in list(groups.items())[:9]:
                sy = text(c, f'{mb} × {mh} · {ROLE.get(role, role)} · {count} шт.', sx, sy, 7.5, width=250) - 6
            text(c, f'Всего {len(members)} физических деталей.\nКрасным - переданные геометрические выборки.\nFG - группа; точные ID и позиции - в CSV/JSON.', sx, y + 49, 7, color=MUTED, width=250)

    def draw_roofplan(self, c, data, index):
        annex_roofs = [(annex, face) for annex in self.annexes for face in (annex.get('roof') or {}).get('surfaces') or []]
        pts = [xy(p) for s in self.roof.get('surfaces', []) for p in s.get('points', [])] + self.level_polygon() + [xy(p) for z in self.roof.get('zones', []) for p in z.get('coverPolygon', [])] + [xy(p) for _, face in annex_roofs for p in face.get('points') or []]
        fn, scale = transform(pts, (45, 135, 800, H - 245), 45)
        polygon(c, [fn(p) for p in self.level_polygon()], None, LINE, 1)
        for annex, face in annex_roofs:
            polygon(c, [fn(xy(p)) for p in face.get('points') or []], colors.HexColor('#e3edf0'), BLUE, .8)
        palette = [colors.HexColor(s) for s in ('#d9e5c7', '#e8d5b6', '#cddfe5', '#e0d7e8')]
        zones = self.roof.get('zones') or []
        for surface in self.roof.get('surfaces') or []:
            zi = next((j for j, z in enumerate(zones) if z.get('id') == surface.get('zoneId')), 0)
            # Tessellation boundaries are not roof joints or valleys. Only
            # explicit roof topology below receives a visible line.
            polygon(c, [fn(xy(p)) for p in surface.get('points', [])], palette[zi % len(palette)], None, .5)
        for zone in zones:
            bearing = [xy(p) for p in (zone.get('bearingPolygon') or zone.get('polygon') or [])]
            cover = [xy(p) for p in (zone.get('coverPolygon') or [])]
            c.setDash([5, 3]); polygon(c, [fn(p) for p in bearing], None, INK, .7); c.setDash([])
            if cover:
                polygon(c, [fn(p) for p in cover], None, GREEN, 1.3)
            overhangs = zone.get('overhangs') or {}
            angle = math.radians(finite(zone.get('ridgeAngle')))
            u, v = (math.cos(angle), math.sin(angle)), (-math.sin(angle), math.cos(angle))
            local = [(p[0] * u[0] + p[1] * u[1], p[0] * v[0] + p[1] * v[1]) for p in bearing]
            lo_u, lo_v, hi_u, hi_v = bounds(local)
            edges = list(zip(bearing, bearing[1:] + bearing[:1]))
            for key, axis, target, direction in [('low', 1, lo_v, (-v[0], -v[1])), ('high', 1, hi_v, v), ('start', 0, lo_u, (-u[0], -u[1])), ('end', 0, hi_u, u)]:
                distance = optional_number(overhangs.get(key))
                if distance is None or distance <= 0:
                    continue
                candidates = []
                for edge_a, edge_b in edges:
                    aa = edge_a[0] * (u if axis == 0 else v)[0] + edge_a[1] * (u if axis == 0 else v)[1]
                    bb = edge_b[0] * (u if axis == 0 else v)[0] + edge_b[1] * (u if axis == 0 else v)[1]
                    if abs(aa - target) < 1e-5 and abs(bb - target) < 1e-5:
                        candidates.append((math.dist(edge_a, edge_b), edge_a, edge_b))
                if candidates:
                    _, aa, bb = max(candidates)
                    start = ((aa[0] + bb[0]) / 2, (aa[1] + bb[1]) / 2)
                    end = (start[0] + direction[0] * distance, start[1] + direction[1] * distance)
                    dimension(c, fn(start), fn(end), 11, number(distance * 1000, 0))
        for ridge in self.roof.get('ridges') or []:
            line(c, fn(xy(ridge.get('start'))), fn(xy(ridge.get('end'))), GREEN, 2)
        drainage = self.roof.get('drainage') or {}
        for flow in drainage.get('arrows') or []:
            arrow(c, fn(xy(flow.get('start'))), fn(xy(flow.get('end'))), BLUE, 1)
        for edge in drainage.get('edges') or []:
            color = {'valley': ORANGE, 'wall-abutment': RED, 'eave': BLUE, 'ridge': GREEN}.get(edge.get('type'))
            if color and edge.get('start') and edge.get('end'):
                line(c, fn(xy(edge['start'])), fn(xy(edge['end'])), color, 1.2)
        x, y = 885, H - 140
        text(c, 'ЗОНЫ КРОВЛИ', x, y, 11, 'Bold', GREEN)
        for j, zone in enumerate(zones):
            zp = [xy(p) for p in zone.get('polygon', [])]
            if zp:
                cc = fn((sum(p[0] for p in zp) / len(zp), sum(p[1] for p in zp) / len(zp)))
                text(c, f'К{j + 1}', cc[0] - 10, cc[1], 14, 'Bold', GREEN)
            y -= 29
            y = text(c, f'К{j + 1} · {zone.get("name", zone.get("id"))}', x, y, 9, 'Bold', width=240) - 9
            y = text(c, f'{zone.get("shape")} / {zone.get("effectiveFraming", "-")}\nУклоны {number(zone.get("pitchLeft"), 1)}° / {number(zone.get("pitchRight"), 1)}°\nНаправление конька {number(zone.get("ridgeAngle"), 1)}°\nПоверхность {number(zone.get("surfaceArea"), 2)} м²', x, y, 8, width=240) - 13
            if zone.get('overhangs'):
                y = text(c, 'Свесы ОТ ОСЕЙ ОПОРНОГО КОНТУРА\nНиз / верх / начало / конец: ' + ' / '.join(number(finite(zone['overhangs'].get(key)) * 1000, 0) for key in ('low', 'high', 'start', 'end')) + ' мм по горизонтали.', x, y, 7.5, width=240) - 17
        facade_ref = (self.p.get('site') or {}).get('overhangReference') or {}
        if all(optional_number(facade_ref.get(key)) is not None for key in ('front', 'rear', 'side')):
            text(c, 'ОТ ГОТОВОГО ФАСАДА', x, y, 8.5, 'Bold', GREEN); y -= 20
            y = text(c, 'Передний / задний / боковые: ' + ' / '.join(number(finite(facade_ref[key]) * 1000, 0) for key in ('front', 'rear', 'side')) + ' мм.\nФасад выступает за каркас на ' + number(finite(facade_ref.get('facadeOutsideFrame')) * 1000, 0) + ' мм. Обе привязки приведены из проекта.', x, y, 7.8, width=240) - 22
        for j, annex in enumerate(self.annexes):
            faces = (annex.get('roof') or {}).get('surfaces') or []
            if not faces: continue
            points = [xyz(p) for face in faces for p in face.get('points') or []]
            if not points: continue
            center = (sum(p[0] for p in points) / len(points), sum(p[2] for p in points) / len(points))
            cc = fn(center); text(c, 'В' + str(j + 1), cc[0] - 7, cc[1] + 5, 11, 'Bold', BLUE)
            high, low = max(p[1] for p in points), min(p[1] for p in points)
            if high - low > 1e-6:
                upper = [p for p in points if abs(p[1] - high) < 1e-6]; lower = [p for p in points if abs(p[1] - low) < 1e-6]
                a = (sum(p[0] for p in upper) / len(upper), sum(p[2] for p in upper) / len(upper)); b = (sum(p[0] for p in lower) / len(lower), sum(p[2] for p in lower) / len(lower))
                arrow(c, fn((a[0] * .45 + b[0] * .55, a[1] * .45 + b[1] * .55)), fn((a[0] * .1 + b[0] * .9, a[1] * .1 + b[1] * .9)), BLUE, 1)
            y = text(c, 'В' + str(j + 1) + ' · ' + clean(annex.get('name', annex.get('id'))) + '\nКровля независимой пристройки; подробный план и опоры - на её листе.', x, y, 8, 'Bold', BLUE, width=240) - 16
        self.note(c, 'Пунктир - оси опорного контура; зелёный - покрытие дома; голубой - кровля веранды. Стрелки - сток; оранжевый - ендовы; красный - примыкания. Размерные линии свесов: от опорных осей, по горизонтали.', y=105)

    def draw_roofsections(self, c, zones, index):
        for j, zone in enumerate(zones or []):
            x, y, w, h = 43, H - 425 - j * 325, W - 86, 305
            c.setStrokeColor(LINE); c.rect(x, y, w, h, fill=0, stroke=1)
            text(c, f'{zone.get("name", zone.get("id"))} · {zone.get("shape")} · {zone.get("effectiveFraming", "-")}', x + 14, y + h - 22, 11, 'Bold')
            angle = math.radians(finite(zone.get('ridgeAngle')))
            vx, vz = -math.sin(angle), math.cos(angle)
            def local(p):
                xx, yy, zz = xyz(p)
                return xx * vx + zz * vz, yy
            members = [m for m in self.members if m.get('zoneId') == zone.get('id')]
            pts = [local(m[k]) for m in members for k in ('start', 'end') if m.get(k)]
            if not pts:
                text(c, 'Физические элементы зоны отсутствуют в отчёте.', x + 20, y + 180, 10, color=ORANGE)
                continue
            fn, scale = transform(pts, (x + 15, y + 33, w * .61, h - 78), 25)
            seen = set()
            for m in members:
                if not m.get('start') or not m.get('end'):
                    continue
                aa, bb = local(m['start']), local(m['end'])
                key = tuple(round(v, 3) for p in (aa, bb) for v in p)
                if key in seen:
                    continue
                seen.add(key)
                line(c, fn(aa), fn(bb), WOOD_DARK, max(1.1, min(6, finite(m.get('h'), 150) / 1000 * scale)))
            mn, lo, mx, hi = bounds(pts)
            dimension(c, fn((mn, lo)), fn((mx, lo)), -15, number((mx - mn) * 1000, 0))
            sx, sy = x + w * .66, y + h - 48
            text(c, 'Задано / принято: ' + clean(zone.get('requestedSection', zone.get('chordSection'))) + ' / ' + clean(zone.get('selectedSection', zone.get('effectiveSection'))), sx, sy, 8.5, 'Bold', width=w * .31)
            sy -= 28
            sy = text(c, zone.get('framingReason', ''), sx, sy, 8, width=w * .31) - 12
            ra = zone.get('rafterAnalysis') or {}
            if ra:
                for label, value in [('Пролёт / длина ската', f'{number(ra.get("horizontalSpan"), 3)} / {number(ra.get("slopeLength"), 3)} м'), ('Напряжение изгиба', number(ra.get('stress'), 3) + ' МПа'), ('Вертикальный прогиб', number(ra.get('verticalDeflection'), 3) + ' / ' + number(ra.get('deflectionAllowed'), 3) + ' мм'), ('Использование η', number(ra.get('utilization'), 4))]:
                    sy = text(c, label + ': ' + value, sx, sy, 8, width=w * .31) - 7
            else:
                analysis = zone.get('analysis') or {}
                sy = text(c, 'Типовая ферма: ' + clean(zone.get('trussType')) + '\nСтатус: ' + clean(analysis.get('status')) + '\nПрименимость: ' + ('типовая схема применима' if zone.get('analysisApplicable') else 'к обрезанным/частичным элементам не подтверждена'), sx, sy, 8, width=w * .31)
            text(c, 'Разрез - проекция повторяющихся рам зоны; совпадающие линии показаны один раз. Опорные узлы не рассчитаны.', sx, y + 40, 7.4, color=ORANGE, width=w * .31)

    def draw_spatial(self, c, space, index):
        poly = [xy(p) for p in space.get('polygon') or []]
        if not poly:
            self.note(c, 'Геометрия пространственного объёма не передана.'); return
        stair = next((s for s in self.spatial.get('staircases') or [] if s.get('id') == space.get('staircaseId')), {})
        gallery_ids = set(map(str, space.get('galleryIds') or []))
        galleries = [g for g in self.spatial.get('galleries') or [] if str(g.get('id')) in gallery_ids]
        a, b, d, e = bounds(poly)
        text(c, 'ВЕРХНИЙ УРОВЕНЬ · ПРОЁМ И ПУТИ ДВИЖЕНИЯ', 48, H - 135, 9, 'Bold', GREEN)
        gallery_points = [xy(p) for g in galleries for p in g.get('polygon') or []]
        fn, scale = transform(poly + gallery_points, (48, 300, 405, 355), 28)
        polygon(c, [fn(p) for p in poly], colors.HexColor('#f3ecdb'), ORANGE, 1)
        for gallery in galleries:
            gp = [xy(p) for p in gallery.get('polygon') or []]
            polygon(c, [fn(p) for p in gp], colors.HexColor('#dce7d1'), GREEN, .8)
        self.draw_actual_stair_plan(c, fn, space.get('upperLevel'), False)
        stair_min = bounds([xy(p) for p in stair.get('polygon') or []])[0] if stair.get('polygon') else d
        label = fn(((a + max(a, min(stair_min, d))) / 2, (b + e) / 2))
        text(c, 'ВТОРОЙ СВЕТ', label[0] - 45, label[1] + 6, 8, 'Bold', ORANGE)
        text(c, 'вид в нижнее помещение', label[0] - 50, label[1] - 9, 6.5, color=MUTED)
        dimension(c, fn((a, b)), fn((d, b)), -24, number((d - a) * 1000, 0))
        lower = next((r for r in self.planning.get('rooms') or [] if r.get('id') == space.get('lowerRoomId')), {})
        facts = [
            ('Нижнее помещение', lower.get('name', space.get('lowerRoomId'))),
            ('Общий проём', clean(space.get('voidId'))),
            ('Этажи / отметки', clean(space.get('lowerLevel')) + ' → ' + clean(space.get('upperLevel')) + '; +' + number(space.get('baseY'), 3) + '…+' + number(space.get('topY'), 3) + ' м'),
            ('Лестница', clean(stair.get('risers')) + ' подъёмов; h=' + number(finite(stair.get('riser')) * 1000, 1) + ' мм; b=' + number(finite(stair.get('tread')) * 1000, 0) + ' мм'),
            ('Ширина марша по модели', number(stair.get('actualClearWidth'), 3) + ' м'),
            ('Галереи / верхние окна', str(len(gallery_ids)) + ' / ' + str(len(space.get('daylightOpeningIds') or [])))
        ]
        yy = 258
        for name, value in facts:
            text(c, name, 48, yy, 7.7, color=MUTED)
            yy = text(c, value, 210, yy, 7.7, 'Bold', width=245) - 12
        text(c, 'ПРОДОЛЬНАЯ ПРОЕКЦИЯ ФАКТИЧЕСКОЙ ЛЕСТНИЦЫ', 493, H - 135, 9, 'Bold', GREEN)
        # Both U-flights are projected onto X/elevation; this is expressly not
        # a cut through the flight gap and does not invent a continuous slab.
        stair_ids = set(map(str, stair.get('boardIds') or []))
        relevant_guards = [g for g in self.spatial.get('guards') or [] if g.get('spatialId') in (stair.get('id'), space.get('id')) or a - .3 <= xyz(g.get('start'))[0] <= d + .3 and b - .4 <= xyz(g.get('start'))[2] <= e + .4]
        guard_ids = {str(v) for g in relevant_guards for v in g.get('boardIds') or []}
        members = [m for m in self.members if str(m.get('id')) in stair_ids | guard_ids]
        project = lambda p: (p[0], p[1])
        profiles = [(m, self.projected_member(m, project)) for m in members]
        low, upper, top = finite(space.get('baseY')), finite(space.get('upperFloorY')), finite(space.get('topY'))
        points = [(x, y) for x in (a - .2, d + .7) for y in (low - .25, top + .3)]
        points += [p for _, shape in profiles for p in shape]
        sf, _ = transform(points, (488, 164, W - 535, 475), 26)
        polygon(c, [sf((a, low)), sf((d, low)), sf((d, top)), sf((a, top))], colors.HexColor('#fbf8ef'), ORANGE, .6)
        # Actual floor section at the report's recommended plane.
        cut_y = finite((space.get('sectionSuggestion') or {}).get('value'), (b + e) / 2)
        for level in self.levels:
            intervals = scan_intervals(self.platform_polygon(level), cut_y)
            holes = [interval for v in self.p.get('voids') or [] if int(v.get('level', 2)) == int(level.get('index', 1)) for interval in scan_intervals([xy(p) for p in v.get('polygon') or []], cut_y)]
            for left, right in subtract_intervals(intervals, holes):
                left, right = max(left, a - .2), min(right, d + .7)
                if right <= left: continue
                bot, deck = finite(level.get('platformBase')), finite(level.get('wallBaseY'))
                polygon(c, [sf((left, bot)), sf((right, bot)), sf((right, deck)), sf((left, deck))], colors.HexColor('#dce7d1'), GREEN, .6)
        for member, shape in profiles:
            is_guard = bool(member.get('guardId')) or str(member.get('role', '')).startswith('guard')
            polygon(c, [sf(p) for p in shape], colors.HexColor('#9d9a71') if is_guard else WOOD, GREEN if is_guard else WOOD_DARK, .45)
        opening_ids = set(map(str, space.get('daylightOpeningIds') or []))
        for opening in self.p.get('openings') or []:
            if str(opening.get('id')) not in opening_ids: continue
            wall = self.wall_map.get(str(opening.get('wallId')), {})
            wa, wb = xy(wall.get('a')), xy(wall.get('b')); L = math.dist(wa, wb)
            if L < 1e-9: continue
            ox = wa[0] + (wb[0] - wa[0]) * finite(opening.get('offset')) / L
            ex = ox + (wb[0] - wa[0]) * finite(opening.get('width')) / L
            level = next((v for v in self.levels if int(v.get('index', 1)) == int(opening.get('floor', wall.get('level', 1)))), {})
            bottom = finite(level.get('wallBaseY')) + finite(opening.get('sill')); high = bottom + finite(opening.get('height'))
            if abs(ex - ox) > .03:
                polygon(c, [sf((ox, bottom)), sf((ex, bottom)), sf((ex, high)), sf((ox, high))], colors.HexColor('#d9e9e6'), BLUE, .8)
                text(c, 'Верхний ярус окон', *sf((min(ox, ex), high + .12)), 6.5, color=BLUE)
        for elevation, label in [(low, 'Нижний пол'), (upper, 'Галерея'), (top, 'Верх объёма')]:
            aa, bb = sf((a - .1, elevation)), sf((d + .65, elevation)); line(c, aa, bb, LINE, .5, [4, 3])
            text(c, label + ' +' + number(elevation, 3), bb[0] - 95, bb[1] + 6, 7, color=MUTED)
        text(c, 'ВТОРОЙ СВЕТ', *sf((a + .2, low + (upper - low) * .56)), 11, 'Bold', ORANGE)
        self.note(c, 'Ступени, косоуры с пильным профилем и ограждения взяты из физических досок. Проекция показывает оба марша; это не новый расчёт лестницы. Крепёж, поручни, анкеры и нагрузки ограждений не подтверждены.', y=103)

    def draw_annexcatalog(self, c, data, index):
        variants = [('openTerrace', '01 · Открытая терраса', 'Настил на независимом свайном основании. Кровля и остекление отсутствуют.'), ('coveredTerrace', '02 · Крытая открытая веранда', 'Настил, стойки и односкатная кровля на собственных опорах. Сток направлен от дома.'), ('glazedVeranda', '03 · Холодная остеклённая веранда', 'Независимый каркас и кровля; остекление неотапливаемого объёма. Тепловой контур дома сохраняется.')]
        for i, (kind, title, description) in enumerate(variants):
            x, y, width = 47 + i * 367, H - 164, 348
            c.setFillColor(PAPER); c.setStrokeColor(LINE); c.roundRect(x, 390, width, 270, 9, fill=1, stroke=1)
            text(c, title, x + 17, y, 13, 'Bold', GREEN, width=310)
            text(c, description, x + 17, y - 46, 10, width=310)
            actual = [a for a in data if a.get('kind') == kind]
            yy = y - 127
            if actual:
                badge(c, 'ЕСТЬ В ТЕКУЩЕЙ МОДЕЛИ', x + 17, yy, GREEN); yy -= 30
                for item in actual:
                    text(c, clean(item.get('name', item.get('id'))) + ' · ' + number(item.get('area'), 2) + ' м²', x + 17, yy, 10, 'Bold', width=310); yy -= 23
            else:
                text(c, 'Поддерживается движком MCP.\nВ текущем выпуске геометрия этого варианта не задана.', x + 17, yy, 9, color=MUTED, width=310)
        text(c, 'ФАКТИЧЕСКИЙ СОСТАВ ВЫПУСКА', 47, 347, 11, 'Bold', GREEN)
        y = 312
        for item in data:
            members = [m for m in self.members if m.get('annexId') == item.get('id')]
            piles = [p for p in self.r.get('piles') or [] if p.get('annexId') == item.get('id')]
            row = clean(item.get('name', item.get('id'))) + ': ' + number(item.get('area'), 2) + ' м²; ' + str(len(piles)) + ' свай; ' + str(len(members)) + ' физических досок; ' + str(len(item.get('glazing') or [])) + ' панелей остекления.'
            y = text(c, row, 47, y, 10, width=W - 100) - 21
        self.note(c, 'Количество и стоимость берутся только из заданной геометрии текущего проекта. Варианты без геометрии не получают вымышленные размеры, материалы или цену. Общие планы дома и отапливаемая площадь сохраняют самостоятельные границы.', y=157)

    def draw_annex(self, c, annex, index):
        aid = annex.get('id'); members = [m for m in self.members if m.get('annexId') == aid]
        piles = [p for p in self.r.get('piles') or [] if p.get('annexId') == aid]
        poly = [xy(p) for p in annex.get('polygon') or []]
        text(c, 'ПЛАН · НАСТИЛ, НЕЗАВИСИМОЕ ОСНОВАНИЕ И КРОВЛЯ', 48, H - 135, 9, 'Bold', GREEN)
        fn, scale = transform(poly + [(p.get('x', 0), p.get('y', 0)) for p in piles], (48, 345, 495, 309), 35)
        polygon(c, [fn(p) for p in poly], PAPER, GREEN, 1)
        marks = set()
        occupied = [(fn(xy(p))[0] - 5, fn(xy(p))[1] - 5, fn(xy(p))[0] + 25, fn(xy(p))[1] + 16) for p in piles]
        for m in members:
            if m.get('category') not in ('floor', 'foundation'): continue
            role = str(m.get('role', '')); color = GREEN if 'Rim' in role else WOOD_DARK
            line(c, fn(xy(m['start'])), fn(xy(m['end'])), color, max(.6, finite(m.get('b')) / 1000 * scale))
            fg = self.marks.get(str(m.get('id')))
            if fg and fg not in marks:
                marks.add(fg); aa, bb = fn(xy(m['start'])), fn(xy(m['end']))
                center = ((aa[0] + bb[0]) / 2, (aa[1] + bb[1]) / 2)
                tw = pdfmetrics.stringWidth(fg, 'Body', 6)
                for ox, oy in [(7, 13), (7, -15), (-tw - 7, 13), (-tw - 7, -15), (18, 25), (-tw - 18, -26)]:
                    label_box = (center[0] + ox - 2, center[1] + oy - 3, center[0] + ox + tw + 2, center[1] + oy + 8)
                    if not any(label_box[0] < q[2] and label_box[2] > q[0] and label_box[1] < q[3] and label_box[3] > q[1] for q in occupied):
                        occupied.append(label_box); text(c, fg, center[0] + ox, center[1] + oy, 6, color=color); break
        for i, pile in enumerate(piles):
            xx, yy = fn(xy(pile)); c.setFillColor(GREEN); c.circle(xx, yy, 3.3, fill=1, stroke=0)
            text(c, 'A' + str(i + 1), xx + 5, yy + 5, 6.5, 'Bold', GREEN)
        for face in (annex.get('roof') or {}).get('surfaces') or []:
            polygon(c, [fn(xy(p)) for p in face.get('points') or []], None, BLUE, .9)
        if poly:
            a, b, d, e = bounds(poly)
            dimension(c, fn((a, b)), fn((d, b)), -24, number((d - a) * 1000, 0))
            dimension(c, fn((d, b)), fn((d, e)), -24, number((e - b) * 1000, 0))
        text(c, 'ПРОЕКЦИЯ ПО НАПРАВЛЕНИЮ ОТ СТЕНЫ ДОМА', 600, H - 135, 9, 'Bold', GREEN)
        frame = annex.get('frame') or {}; origin = xy(frame.get('origin')); normal = xy(frame.get('outward') or {'x': 0, 'y': 1})
        project = lambda p: ((p[0] - origin[0]) * normal[0] + (p[2] - origin[1]) * normal[1], p[1])
        profiles = [(m, self.projected_member(m, project)) for m in members]
        surfaces = [(s, [project(xyz(p)) for p in s.get('points') or []]) for s in (annex.get('roof') or {}).get('surfaces') or []]
        glazing = [(s, [project(xyz(p)) for p in s.get('polygon') or []]) for s in annex.get('glazing') or []]
        points = [p for _, shape in profiles + surfaces + glazing for p in shape]
        points += [project((finite(p.get('x')), -.12, finite(p.get('y')))) for p in piles]
        sf, _ = transform(points or [(0, 0), (1, 1)], (600, 345, W - 650, 310), 35)
        for p in piles:
            low = project((finite(p.get('x')), -.12, finite(p.get('y')))); top = project((finite(p.get('x')), finite(p.get('capTopY', p.get('headY')), .72), finite(p.get('y'))))
            line(c, sf(low), sf(top), GREEN, 3)
        for m, shape in profiles:
            polygon(c, [sf(p) for p in shape], WOOD, WOOD_DARK, .5)
        for _, shape in surfaces:
            polygon(c, [sf(p) for p in shape], None, BLUE, 1)
            if shape:
                high, low = max(shape, key=lambda p: p[1]), min(shape, key=lambda p: p[1])
                arrow(c, sf((high[0], high[1] + .3)), sf((low[0], low[1] + .3)), BLUE, .8)
                text(c, 'Сток от дома', *sf(((high[0] + low[0]) / 2, (high[1] + low[1]) / 2 + .42)), 6.5, color=BLUE)
        for _, shape in glazing:
            polygon(c, [sf(p) for p in shape], colors.Color(.65, .8, .8, alpha=.25), BLUE, .6)
        roof = annex.get('roof') or {}
        for gutter in roof.get('gutters') or []:
            path = gutter.get('path') or [gutter.get('start'), gutter.get('end')]
            for a, b in zip(path, path[1:]):
                if a and b: line(c, sf(project(xyz(a))), sf(project(xyz(b))), BLUE, 2)
        text(c, 'ФАКТИЧЕСКИЕ МАТЕРИАЛЫ И ОПОРЫ', 48, 287, 10, 'Bold', GREEN)
        q = annex.get('quantities') or {}; y = 259
        sections = collections.Counter((m.get('b'), m.get('h')) for m in members)
        facts = [('ID / тип', clean(aid) + ' / ' + clean(annex.get('kind'))), ('Площадь настила / отметка', number(annex.get('area'), 2) + ' м² / +' + number(annex.get('deckTopY'), 3) + ' м'), ('Доски / объём физических деталей', str(len(members)) + ' / ' + number(sum(finite(m.get('grossVolume', m.get('volume'))) for m in members), 4) + ' м³'), ('Сечения', '; '.join(f'{b} × {h}: {count} шт.' for (b, h), count in sections.items())), ('Сваи / реакции Fd', str(len(piles)) + ' / ' + '; '.join('A' + str(i + 1) + '=' + number(p.get('reaction'), 2) for i, p in enumerate(piles)) + ' кН')]
        for name, value in facts:
            text(c, name, 48, y, 7.5, color=MUTED); y = text(c, value, 222, y, 7.5, width=330) - 13
        x, y = 600, 287
        text(c, 'СОСТАВ И ГРАНИЦЫ ПРОВЕРКИ', x, y, 10, 'Bold', GREEN); y -= 28
        thermal_note = 'Остеклённая веранда остаётся неотапливаемой; тепловой контур дома не расширен.' if annex.get('kind') == 'glazedVeranda' else 'Открытая пристройка не увеличивает отапливаемую площадь дома.'
        items = ['Кровля: ' + ('есть' if roof.get('surfaces') else 'не задана') + '; остекление: ' + str(len(annex.get('glazing') or [])) + ' панелей.', thermal_note, 'Опоры, примыкание и отвод воды показаны по отчёту. Грунт, крепёж, анкеры, устойчивость и узлы влагоотвода требуют проектирования.']
        for item in items:
            y = text(c, item, x, y, 8.3, width=525) - 15
        self.note(c, 'План и проекция построены только по фактическим деталям и поверхностям. Цифры A1… связывают сваи на этом листе; полные IDs, FG и FP доступны в CSV / JSON. Сваи под домом не заменяются пристройкой.', y=99)

    def draw_section(self, c, data, index):
        voids = [v for v in self.p.get('voids', []) if v.get('kind') == 'doubleHeight']
        vp = [xy(p) for p in (voids[0].get('polygon', []) if voids else [])]
        basepts = self.platform_polygon()
        cut_y = (bounds(vp)[1] + bounds(vp)[3]) / 2 if vp else (bounds(basepts)[1] + bounds(basepts)[3]) / 2
        visible = []
        # Geometric intersection of each board axis with a section band, not a fictitious frame.
        for m in self.members:
            if not m.get('start') or not m.get('end'):
                continue
            a, b = xyz(m['start']), xyz(m['end'])
            if min(a[2], b[2]) - .12 <= cut_y <= max(a[2], b[2]) + .12:
                if abs(a[2] - b[2]) < .05:
                    if abs(a[2] - cut_y) < .12:
                        visible.append((m, (a[0], a[1]), (b[0], b[1])))
                else:
                    t = max(0, min(1, (cut_y - a[2]) / (b[2] - a[2])))
                    xx, yy = a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])
                    visible.append((m, (xx - finite(m.get('b'), 50) / 2000, yy), (xx + finite(m.get('b'), 50) / 2000, yy)))
        pts = [p for _, a, b in visible for p in (a, b)]
        for s in self.roof.get('surfaces', []):
            sp = [xyz(p) for p in s.get('points', [])]
            hits = []
            for a, b in zip(sp, sp[1:] + sp[:1]):
                if abs(a[2] - b[2]) > 1e-9 and min(a[2], b[2]) <= cut_y <= max(a[2], b[2]):
                    t = (cut_y - a[2]) / (b[2] - a[2])
                    hits.append((a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])))
            if len(hits) >= 2:
                visible.append(({'category': 'surface'}, hits[0], hits[1])); pts += hits
        wall_slices = []
        profiles = {str(p.get('wallId')): p for p in self.g.get('wallProfiles', [])}
        for wall in self.p.get('walls') or []:
            a, b = xy(wall.get('a')), xy(wall.get('b'))
            if abs(b[1] - a[1]) < 1e-8 or not (min(a[1], b[1]) - 1e-8 <= cut_y <= max(a[1], b[1]) + 1e-8):
                continue
            t = (cut_y - a[1]) / (b[1] - a[1])
            xx = a[0] + t * (b[0] - a[0])
            length = math.hypot(b[0] - a[0], b[1] - a[1])
            station = t * length
            level = next((v for v in self.levels if int(v.get('index', 1)) == int(wall.get('level', 1))), {})
            profile = profiles.get(str(wall.get('id')), {})
            base_y = finite(profile.get('baseY', level.get('wallBaseY')))
            samples = sorted(profile.get('topSamples') or [], key=lambda s: finite(s.get('s')))
            top_y = finite(profile.get('topAtA', level.get('topY')))
            for sa, sb in zip(samples, samples[1:]):
                if finite(sa.get('s')) - 1e-7 <= station <= finite(sb.get('s')) + 1e-7:
                    tt = (station - finite(sa.get('s'))) / max(1e-9, finite(sb.get('s')) - finite(sa.get('s')))
                    top_y = finite(sa.get('topY')) + tt * (finite(sb.get('topY')) - finite(sa.get('topY')))
                    break
            _, thickness = self.section_size(self.wall_section(wall))
            width = thickness / 1000 / max(.1, abs((b[1] - a[1]) / max(length, .001)))
            wall_slices.append((xx, base_y, top_y, width))
            pts += [(xx - width / 2, base_y), (xx + width / 2, top_y)]
        platforms = []
        for level in self.levels:
            intervals = scan_intervals(self.platform_polygon(level), cut_y)
            holes = []
            for void in self.p.get('voids') or []:
                if int(void.get('level', 2)) == int(level.get('index', 1)):
                    holes += scan_intervals([xy(p) for p in void.get('polygon', [])], cut_y)
            intervals = subtract_intervals(intervals, holes)
            low_y, high_y = finite(level.get('platformBase')), finite(level.get('wallBaseY'))
            platforms += [(a, b, low_y, high_y) for a, b in intervals]
        pts += [(p[0], 0) for p in basepts]
        fn, scale = transform(pts, (55, 140, W - 315, H - 265), 45)
        for xx, low_y, high_y, width in wall_slices:
            polygon(c, [fn((xx - width / 2, low_y)), fn((xx + width / 2, low_y)), fn((xx + width / 2, high_y)), fn((xx - width / 2, high_y))], WOOD, WOOD_DARK, .7)
        for a, b, low_y, high_y in platforms:
            polygon(c, [fn((a, low_y)), fn((b, low_y)), fn((b, high_y)), fn((a, high_y))], colors.HexColor('#e0e7d4'), GREEN, .6)
        for m, a, b in visible:
            line(c, fn(a), fn(b), GREEN if m.get('category') == 'surface' else WOOD_DARK, 1.3 if m.get('category') == 'surface' else 2)
        a, lo, b, hi = bounds(pts)
        line(c, fn((a - .4, 0)), fn((b + .4, 0)), LINE, 1)
        for level in self.levels:
            for key, label in [('platformBase', 'Низ платформы'), ('wallBaseY', 'Основание стены'), ('topY', 'Номинальный верх')]:
                yy = finite(level.get(key))
                p1, p2 = fn((a, yy)), fn((b, yy))
                line(c, p1, p2, LINE, .6, [5, 4])
                text(c, '+' + number(yy, 3), p2[0] + 12, p2[1] - 2, 8, 'Bold')
        for void in voids:
            poly = [xy(p) for p in void.get('polygon', [])]
            va, vb, vc, vd = bounds(poly)
            if vb <= cut_y <= vd:
                level = next((l for l in self.levels if int(l.get('index', 1)) == int(void.get('level', 2))), {})
                yy = finite(level.get('platformBase'))
                aa, bb = fn((va, yy)), fn((vc, yy))
                dimension(c, aa, bb, 27, 'ВТОРОЙ СВЕТ ' + number((vc - va) * 1000, 0))
        text(c, f'Разрез при Y = {number(cut_y, 3)} м', W - 265, H - 150, 11, 'Bold', width=220)
        text(c, 'Показаны пересечения стен, платформ и кровли фактической модели. Сечения стен берутся по текущему высотному профилю.\n\n' + ('Пустота второго света вычтена из платформы. ' if voids else '') + 'Зелёная полоса - габарит платформы, не сплошной материал.\n\nОтметки относятся к единому нулю цифровой модели.', W - 265, H - 192, 9, color=MUTED, width=215)

    def draw_insulatedcorner(self, c, detail, index):
        exterior = next((w for w in self.p.get('walls') or [] if w.get('kind') == 'exterior'), {})
        b, h = self.section_size(exterior.get('section', '48x198'))
        wall_assembly = next((a for a in (self.p.get('envelope') or {}).get('assemblies') or [] if a.get('id') == 'wall'), {})
        outside_layer = next((layer for layer in wall_assembly.get('layers') or [] if layer.get('id') == 'external-insulation'), {})
        continuous = max(0, finite(outside_layer.get('thickness')) * 1000)
        reach = max(600, h * 3)
        fn, sc = transform([(-continuous - 65, -continuous - 65), (reach + 45, reach + 45)], (48, 160, 650, 530), 34)
        text(c, 'ПЛАН · ОТКРЫТАЯ ПОЛОСТЬ ДЛЯ УТЕПЛЕНИЯ', 48, H - 137, 10, 'Bold', GREEN)
        if continuous:
            band = [(-continuous, -continuous), (reach, -continuous), (reach, 0), (0, 0), (0, reach), (-continuous, reach)]
            polygon(c, [fn(p) for p in band], colors.HexColor('#cbdcb3'), GREEN, .7)
        wall = [(0, 0), (reach, 0), (reach, h), (h, h), (h, reach), (0, reach)]
        polygon(c, [fn(p) for p in wall], colors.HexColor('#e4edcd'), GREEN, .7)
        # Same two non-overlapping b×h rectangles as the schematic California2
        # convention. Membrane offsets are graphic offsets, never real thickness.
        boards = [[(0, 0), (b, 0), (b, h), (0, h)], [(b, 0), (b + h, 0), (b + h, b), (b, b)]]
        for mark, points in zip(('A', 'B'), boards):
            polygon(c, [fn(p) for p in points], WOOD, WOOD_DARK, 1)
            center = (sum(p[0] for p in points) / 4, sum(p[1] for p in points) / 4)
            xx, yy = fn(center); text(c, mark, xx - 3, yy - 3, 9, 'Bold')
        inner = [(reach, h + 10), (h + 10, h + 10), (h + 10, reach)]
        outer = [(reach, -continuous - 12), (-continuous - 12, -continuous - 12), (-continuous - 12, reach)]
        for a, z in zip(inner, inner[1:]): line(c, fn(a), fn(z), BLUE, 2.6)
        for a, z in zip(outer, outer[1:]): line(c, fn(a), fn(z), ORANGE, 2.3)
        corner = fn((h + 10, h + 10)); c.setStrokeColor(BLUE); c.setLineWidth(1.1); c.circle(*corner, 9, fill=0, stroke=1)
        line(c, corner, fn((h + 145, h + 145)), BLUE, .8)
        text(c, 'Непрерывный поворот\nи проклейка стыков', *fn((h + 150, h + 150)), 8, color=BLUE, width=150)
        cavity = ((b + h) / 2, (b + h) / 2)
        note_point = (b + h + 85, h - 20)
        line(c, fn(cavity), fn((note_point[0] - 6, note_point[1] - 4)), GREEN, .6)
        text(c, 'Утеплитель в открытой\nугловой полости', *fn(note_point), 7, color=GREEN, width=120)
        text(c, 'ВНУТРИ', *fn((h + 155, h + 330)), 12, 'Bold', MUTED)
        text(c, 'СНАРУЖИ', *fn((reach * .4, -continuous - 53)), 8, 'Bold', ORANGE)
        if continuous:
            text(c, 'Сплошной наружный слой ' + number(continuous, 0) + ' мм', *fn((h + 65, -continuous * .6)), 7, color=GREEN)
        dimension(c, fn((0, reach)), fn((h, reach)), 19, number(h, 0) + ' мм · глубина каркаса')
        dimension(c, fn((0, 0)), fn((b, 0)), -27, number(b, 0))
        x, y = 755, H - 143
        text(c, detail.get('name', 'Утепляемый двухстоечный угол'), x, y, 16, 'Bold', GREEN, width=375); y -= 63
        text(c, '2 × ' + number(b, 0) + ' × ' + number(h, 0) + ' мм', x, y, 20, 'Bold'); y -= 41
        for label, key, color in [('Воздушный барьер', 'airBarrier', BLUE), ('Наружный ветрозащитный слой', 'windBarrier', ORANGE), ('Теплоизоляция', 'insulation', GREEN)]:
            line(c, (x, y + 3), (x + 22, y + 3), color, 2.7)
            text(c, label, x + 31, y, 10, 'Bold', color); y -= 23
            y = text(c, detail.get(key) or 'Состав и сопряжение уточняются в рабочем узле.', x, y, 8.6, width=375) - 21
        notes = detail.get('notes') or []
        if isinstance(notes, str): notes = [notes]
        for note in notes:
            y = text(c, clean(note), x, y, 8.1, width=375) - 12
        y = min(y, 245)
        text(c, 'ГЕРМЕТИЧНОСТЬ НЕ ПОДТВЕРЖДЕНА', x, y, 9, 'Bold', ORANGE); y -= 22
        y = text(c, 'Непрерывность нарисованной линии не подтверждает герметичность собранного узла. Нужны совместимость лент и мембран, основание для приклейки, рабочие нахлёсты, сопряжение с полом/кровлей и проверка оболочки здания.', x, y, 8.3, width=375) - 19
        for source in detail.get('sourceUrls') or []:
            url = source.get('url') if isinstance(source, dict) else str(source)
            if url.startswith(('https://', 'http://')):
                label = clean(source.get('title') or url) if isinstance(source, dict) else url
                new_y = text(c, label, x, y, 6.4, color=BLUE, width=375)
                c.linkURL(url, (x, new_y, x + 375, y + 8), relative=0, thickness=0); y = new_y - 6
        self.note(c, 'СХЕМА СЛОЁВ: толщины мембран и отделки условные. Стойки A/B не пересекаются; их крепёж, опирание обшивки, тепловой мост и влагорежим угла требуют отдельного рабочего решения.', y=102)

    def draw_details(self, c, data, index):
        cards = [(43, 410, 535, 290), (610, 410, 535, 290), (43, 105, 535, 285), (610, 105, 535, 285)]
        titles = ['01 · Оголовок → пакет → платформа → стена', '02 · Наращивание досок из модели', '03 · Проём и обрамление перекрытия', '04 · Врезная укосина / плитная диафрагма']
        for box, title in zip(cards, titles):
            x, y, w, h = box; c.setStrokeColor(LINE); c.rect(x, y, w, h, fill=0, stroke=1); text(c, title, x + 14, y + h - 22, 10, 'Bold')
        x, y, w, h = cards[0]
        text(c, 'Геометрическая схема слоёв. Крепёж, контактные напряжения и совместная работа пакета не рассчитаны.', x + 14, y + 24, 7.5, color=ORANGE, width=w - 28)
        nodes = self.platform_alignment_nodes()
        if nodes:
            detail_page = next((i + 1 for i, page in enumerate(self.pages) if page['kind'] == 'platformdetails'), None)
            text(c, 'Размерный узел наружных граней · лист ' + clean(detail_page), x + 15, y + h - 56, 11, 'Bold', GREEN)
            node = nodes[0]
            yy = y + h - 87
            for label, value in [('Пакет ростверка', number(node.get('backingWidth'), 0) + ' мм'), ('Глубина наружного каркаса', number(node.get('wallDepth'), 0) + ' мм'), ('Толщина rim', number(node.get('rimWidth'), 0) + ' мм'), ('Смещение оси rim', number(node.get('rimAxisOffset'), 0) + ' мм'), ('Наружный выпуск пакета', number(node.get('grillageReveal'), 0) + ' мм')]:
                text(c, label, x + 15, yy, 8.5, color=MUTED); text(c, value, x + 300, yy, 10, 'Bold'); yy -= 22
            text(c, 'Два опирания: ростверк первого этажа и огибающая каркаса нижней стены второго этажа. Геометрия не подтверждает рабочие узлы.', x + 15, y + 63, 8, width=w - 30)
        else:
            text(c, 'Размерный узел наружных граней не передан. Требуются фактический контур платформы, ширина обвязки и геометрия нижних опор.', x + 15, y + h - 70, 10, color=ORANGE, width=w - 30)
        x, y, w, h = cards[1]
        splices = self.r.get('splices') or []
        splice = next((s for s in splices if isinstance(s, dict)), {}) if isinstance(splices, list) else {}
        scheme = splice.get('scheme') or (self.p.get('joints') or {}).get('spliceScheme') or 'не задана'
        text(c, 'Схема: ' + self.end_label({'scheme': scheme, 'lapLength': splice.get('lapLength')}), x + 16, y + h - 54, 9, 'Bold')
        yy, xx = y + 125, x + 55
        if scheme == 'halfLap':
            polygon(c, [(xx, yy), (xx + 220, yy), (xx + 220, yy + 18), (xx + 155, yy + 18), (xx + 155, yy + 36), (xx, yy + 36)], WOOD, WOOD_DARK)
            polygon(c, [(xx + 155, yy + 18), (xx + 220, yy + 18), (xx + 220, yy + 36), (xx + 380, yy + 36), (xx + 380, yy + 54), (xx + 155, yy + 54)], LIME, GREEN)
        elif scheme == 'scarf':
            polygon(c, [(xx, yy), (xx + 230, yy), (xx + 160, yy + 35), (xx, yy + 35)], WOOD, WOOD_DARK)
            polygon(c, [(xx + 230, yy), (xx + 380, yy), (xx + 380, yy + 35), (xx + 160, yy + 35)], LIME, GREEN)
        else:
            for j in range(2):
                c.setFillColor(WOOD if j == 0 else LIME); c.setStrokeColor(WOOD_DARK); c.rect(xx + j * 190, yy, 190, 36, fill=1, stroke=1)
        text(c, 'Стык: ' + clean(splice.get('id', 'нет в отчёте')), x + 16, y + 75, 7.5, 'Mono', width=w - 32)
        text(c, 'Показана форма переданного соединения, без схемы крепежа. Нахлёст включается в заготовку только по данным движка.', x + 14, y + 40, 7.5, color=ORANGE, width=w - 28)
        x, y, w, h = cards[2]
        for j in range(6):
            xx = x + 65 + j * 67
            if j not in (2, 3):
                line(c, (xx, y + 65), (xx, y + 205), WOOD_DARK, 7)
        for yy in (y + 97, y + 173):
            line(c, (x + 132, yy), (x + 333, yy), ORANGE, 8)
        for xx in (x + 132, x + 333):
            line(c, (xx, y + 65), (xx, y + 205), ORANGE, 8)
        text(c, 'ПРОЁМ', x + 211, y + 130, 11, 'Bold', ORANGE)
        text(c, 'Схема чтения обрамления. Число, сечения и марки фактических досок приведены на плане перекрытия; узел передачи усилий не рассчитан.', x + 14, y + 38, 7.5, color=ORANGE, width=w - 28)
        x, y, w, h = cards[3]
        br = self.r.get('bracingModel') or {}
        method = br.get('method', (self.p.get('bracing') or {}).get('method'))
        for j in range(5):
            line(c, (x + 75 + j * 75, y + 72), (x + 75 + j * 75, y + 205), WOOD_DARK, 6)
        for yy in (y + 72, y + 205):
            line(c, (x + 75, yy), (x + 375, yy), WOOD_DARK, 7)
        if method == 'letIn':
            line(c, (x + 95, y + 72), (x + 230, y + 205), GREEN, 11)
            text(c, 'Одна врезная диагональ; не наружный X', x + 25, y + 239, 8)
        elif method == 'sheathing':
            polygon(c, [(x + 75, y + 72), (x + 225, y + 72), (x + 225, y + 205), (x + 75, y + 205)], colors.Color(.8, .88, .67, alpha=.7), GREEN, 1)
            text(c, 'Кромки плит: требуется опирание на каркас / блокинг', x + 25, y + 239, 8)
        text(c, 'Путь усилий: кровля/перекрытие → диафрагма → обвязка → анкеры → фундамент. Несущая способность без схемы крепежа не подтверждена.', x + 14, y + 38, 7.5, color=ORANGE, width=w - 28)

    def draw_loads(self, c, data, index):
        loads = self.r.get('loads') or {}
        x, y = 43, H - 137
        text(c, 'ИТОГИ РАСЧЁТНОЙ МОДЕЛИ', x, y, 11, 'Bold', GREEN); y -= 32
        for key, label, unit in [('totalCharacteristic', 'Сумма характеристических вертикальных', 'кН'), ('totalDesign', 'Сумма расчётных вертикальных', 'кН'), ('timberWeight', 'Вес древесины', 'кН'), ('structuralPanelWeight', 'Вес конструкционных плит', 'кН'), ('floorArea', 'Расчётная площадь перекрытий', 'м²'), ('roofArea', 'Площадь скатов', 'м²'), ('projectedRoofArea', 'Проекция кровли', 'м²'), ('windForceX', 'Ветер, ось X', 'кН'), ('windForceY', 'Ветер, ось Y', 'кН')]:
            text(c, label, x, y, 9); text(c, number(loads.get(key), 4) + ' ' + unit, x + 365, y, 10, 'Bold'); line(c, (x, y - 9), (x + 525, y - 9)); y -= 32
        x, y = 640, H - 137
        text(c, 'ПРИНЯТЫЕ ИСХОДНЫЕ', x, y, 11, 'Bold', GREEN); y -= 30
        labels = {'floorDead': 'Постоянная пола, кН/м²', 'live': 'Полезная, кН/м²', 'roofDead': 'Постоянная кровли, кН/м²', 'wallDead': 'Постоянная стен, кН/м²', 'openingDead': 'Заполнение проёмов, кН/м²', 'snow': 'Снег, кН/м²', 'wind': 'Ветер, кН/м²', 'gammaG': 'Коэффициент γG', 'gammaQ': 'Коэффициент γQ'}
        for key, value in (self.p.get('loads') or {}).items():
            y = text(c, labels.get(key, key) + ': ' + clean(value), x, y, 9, width=490) - 10
        text(c, 'МАТЕРИАЛ', x, y - 14, 10, 'Bold', GREEN); y -= 38
        for key, value in (self.p.get('material') or {}).items():
            y = text(c, key + ': ' + clean(value), x, y, 8, width=490) - 5
        self.note(c, 'Значения воспроизведены из отчёта. Сочетания, снеговые мешки, пространственная устойчивость, местные условия и соединения требуют отдельной проверки.', y=109, color=ORANGE)

    def draw_snow(self, c, data, index):
        assessment, cases = data
        text(c, 'СНЕГ НА ГРУНТЕ sk', 43, H - 135, 9, 'Bold', GREEN)
        text(c, number(assessment.get('groundSnow'), 3) + ' кН/м²', 43, H - 165, 22, 'Bold')
        text(c, 'МЕТОД / ОСНОВАНИЕ', 330, H - 135, 9, 'Bold', GREEN)
        text(c, clean(assessment.get('coefficientMethod')), 330, H - 157, 9, width=W - 380)
        text(c, clean(assessment.get('basis')), 330, H - 184, 8, color=MUTED, width=W - 380)
        text(c, 'Сравнение принятых нагрузок на неизменных сечениях', 43, H - 234, 12, 'Bold')
        columns = [('Случай / тип', .16), ('Множители зон', .14), ('Снег Fk, кН', .09), ('Всего Fd, кН', .1), ('Max свая, кН', .1), ('Ростверк ηmax', .1), ('Стропила / сечение / ηmax', .18), ('Статус', .13)]
        widths = [(W - 86) * col[1] for col in columns]
        scale_width = (W - 86) / sum(widths)
        widths = [v * scale_width for v in widths]
        xx, top = 43, H - 253
        c.setFillColor(INK); c.rect(xx, top - 29, W - 86, 29, fill=1, stroke=0)
        for col, width in zip(columns, widths):
            text(c, col[0], xx + 6, top - 13, 7.5, 'Bold', colors.white, width=width - 12)
            xx += width
        y = top - 29
        for i, case in enumerate(cases):
            if not isinstance(case, dict):
                continue
            factors = case.get('zoneFactors') or {}
            factors_text = '\n'.join(clean(key) + ': ' + number(value, 3) for key, value in factors.items()) if isinstance(factors, dict) else clean(factors)
            rafters = []
            for rafter in case.get('rafters') or []:
                if not isinstance(rafter, dict):
                    continue
                analysis = rafter.get('analysis') or {}
                rafters.append(clean(rafter.get('zoneId')) + '\n' + clean(rafter.get('section')) + ' · η=' + number(analysis.get('utilization'), 4))
            status = 'Есть невыполненные проверки' if case.get('status') == 'fail' else 'Частный скрининг' if case.get('status') == 'screen_pass' else clean(case.get('status'))
            status += '\nСечения: ' + ('фиксированы' if case.get('sectionsFixed') is True else 'не подтверждено')
            row = [clean(case.get('name', case.get('id'))) + '\n' + clean(case.get('id')) + '\n' + clean(case.get('kind')), factors_text, number(case.get('snowCharacteristic', case.get('snowTotal')), 3), number(case.get('totalDesign'), 3), number(case.get('maxPileReaction'), 3), number(case.get('maxGrillageUtilization'), 4), '\n'.join(rafters) or '-', status]
            rh = max(62, max(len(wrap(value, width - 12, 'Body', 7.5)) for value, width in zip(row, widths)) * 9.2 + 14)
            c.setFillColor(PAPER if i % 2 == 0 else colors.white); c.rect(43, y - rh, W - 86, rh, fill=1, stroke=0)
            xx = 43
            for value, width in zip(row, widths):
                text(c, value, xx + 6, y - 13, 7.5, color=RED if case.get('status') == 'fail' else INK, width=width - 12, leading=9.2)
                xx += width
            line(c, (43, y - rh), (W - 43, y - rh), LINE, .5)
            y -= rh
        if not cases:
            text(c, 'Снеговые случаи не переданы в отчёте.', 50, y - 25, 9, color=ORANGE)
            y -= 50
        y = min(y - 24, 235)
        text(c, 'ГРАНИЦЫ СНЕГОВОГО СКРИНИНГА', 43, y, 9, 'Bold', ORANGE)
        y -= 18
        notes = ['Полный набор местных нормативных требований, сочетания, снеговые мешки и сползание не подтверждены. Равномерный множитель зоны не заменяет форму локального заноса.'] + list(assessment.get('assumptions') or [])
        for note in notes:
            if y < 116:
                break
            y = text(c, '• ' + clean(note), 43, y, 8, color=MUTED, width=W - 90) - 6

    def envelope_chart(self, c, box, title, samples, keys, dew=None):
        x, y, w, h = box
        text(c, title, x, y + h + 5, 9, 'Bold', GREEN)
        data = []
        for sample in samples:
            if not isinstance(sample, dict):
                continue
            px = optional_number(sample.get('x'))
            if px is not None:
                data.append((px, sample))
        data.sort(key=lambda item: item[0])
        values = [optional_number(sample.get(key)) for _, sample in data for key, _, _ in keys]
        values = [value for value in values if value is not None]
        if dew is not None:
            values.append(dew)
        if not data or not values:
            c.setStrokeColor(LINE); c.rect(x, y, w, h, fill=0, stroke=1)
            text(c, 'Данные профиля отсутствуют', x + 15, y + h / 2, 8, color=ORANGE, width=w - 25)
            return
        min_x, max_x = min(p[0] for p in data), max(p[0] for p in data)
        min_y, max_y = min(values), max(values)
        pad = max((max_y - min_y) * .08, 1)
        min_y -= pad; max_y += pad
        if all(key in ('pVapor', 'pSat') for key, _, _ in keys) and min(values) >= 0:
            min_y = 0
        left, bottom, pw, ph = x + 42, y + 30, w - 54, h - 48
        def pos(px, py):
            return left + (px - min_x) / max(1e-9, max_x - min_x) * pw, bottom + (py - min_y) / max(1e-9, max_y - min_y) * ph
        for i in range(4):
            value = min_y + (max_y - min_y) * i / 3
            yy = pos(min_x, value)[1]
            line(c, (left, yy), (left + pw, yy), LINE, .4)
            text(c, number(value, 0 if max_y > 200 else 1), x, yy - 3, 6.3, color=MUTED)
        line(c, (left, bottom), (left + pw, bottom), MUTED, .6)
        line(c, (left, bottom), (left, bottom + ph), MUTED, .6)
        for i in range(3):
            value = min_x + (max_x - min_x) * i / 2
            text(c, number(value * 1000, 0), pos(value, min_y)[0] - 6, bottom - 12, 6.3, color=MUTED)
        text(c, 'x, мм · изнутри наружу', left + 15, y + 3, 6.5, color=MUTED)
        for key, label, color in keys:
            series = [(px, optional_number(sample.get(key))) for px, sample in data]
            previous = None
            for px, py in series:
                if py is None:
                    previous = None
                    continue
                current = pos(px, py)
                if previous:
                    line(c, previous, current, color, 1.4)
                previous = current
        if dew is not None:
            yy = pos(min_x, dew)[1]
            line(c, (left, yy), (left + pw, yy), ORANGE, .8, [4, 3])
        legend_y = y - 13
        xx = x + 6
        for _, label, color in keys:
            line(c, (xx, legend_y + 3), (xx + 14, legend_y + 3), color, 1.4)
            text(c, label, xx + 19, legend_y, 6.8)
            xx += 130
        if dew is not None:
            text(c, 'Пунктир: T росы/инея воздуха помещения', x + 6, y - 26, 6.5, color=ORANGE)

    def draw_envelope(self, c, assembly, index):
        boundary = assembly.get('boundaryConditions') or {}
        indoor = boundary.get('indoor') or {}
        outdoor = boundary.get('outdoor') or {}
        dew_label = 'Точка инея' if assembly.get('dewPointKind') == 'frost' else 'Точка росы воздуха'
        stats = [('R / U однородного поля', number(assembly.get('Rtotal'), 3) + ' м²К/Вт / ' + number(assembly.get('U'), 3) + ' Вт/(м²К)'), ('Uэфф / T внутренней поверхности', number(assembly.get('Ueffective'), 3) + ' Вт/(м²К) / ' + number(assembly.get('internalSurfaceTemp'), 2) + ' °C'), (dew_label + ' / RH поверхности', number(assembly.get('dewPointIndoor'), 2) + ' °C / ' + number(assembly.get('surfaceRH'), 2) + ' %')]
        for j, (label, value) in enumerate(stats):
            x = 43 + j * (W - 86) / 3
            text(c, label, x, H - 135, 8, 'Bold', GREEN)
            text(c, value, x, H - 159, 11, 'Bold', width=(W - 100) / 3)
        text(c, f'Внутри: {number(indoor.get("temperature"), 1)} °C / RH {number(indoor.get("rh"), 1)} %     Снаружи: {number(outdoor.get("temperature"), 1)} °C / RH {number(outdoor.get("rh"), 1)} %     Применение: {clean(assembly.get("appliesTo"))}', 43, H - 188, 8, color=MUTED, width=W - 90)
        layers = [layer for layer in (assembly.get('layers') or []) if isinstance(layer, dict)]
        x, y, width = 43, 585, 350
        text(c, 'СЛОИ ИЗНУТРИ НАРУЖУ', x, 628, 9, 'Bold', GREEN)
        thicknesses = [optional_number(layer.get('thickness')) for layer in layers]
        total = sum(thicknesses) if layers and all(value is not None for value in thicknesses) else None
        # Minimum visible membranes are diagrammatic; all fabrication dimensions are numeric.
        weights = [max(.006, finite(layer.get('thickness'))) for layer in layers]
        weight_sum = sum(weights) or 1
        palette = [WOOD, LIME, colors.HexColor('#b9d0db'), colors.HexColor('#ddceaf'), colors.HexColor('#bdcbb4')]
        xx = x
        for j, (layer, weight) in enumerate(zip(layers, weights)):
            lw = width * weight / weight_sum
            c.setFillColor(palette[j % len(palette)]); c.setStrokeColor(colors.white); c.rect(xx, y, lw, 26, fill=1, stroke=1)
            if lw > 12:
                text(c, j + 1, xx + 3, y + 9, 7, 'Bold')
            xx += lw
        if not layers:
            text(c, 'Состав слоёв не передан', x, y + 8, 8, color=ORANGE)
        total_thickness = optional_number(assembly.get('totalThickness', total))
        caption = 'толщины мембран на схеме увеличены' if total_thickness is not None else 'толщины не заданы; схема без масштаба'
        text(c, f'Σd = {number(total_thickness * 1000 if total_thickness is not None else None, 2)} мм · ' + caption, x, y - 14, 6.7, color=MUTED, width=360)
        text(c, '№ / Слой', x, 552, 6.5, 'Bold', MUTED)
        text(c, 'd, мм', x + 190, 552, 6.5, 'Bold', MUTED)
        text(c, 'λ, Вт/(мК)', x + 235, 552, 6.5, 'Bold', MUTED)
        text(c, 'sd, м', x + 305, 552, 6.5, 'Bold', MUTED)
        for j, layer in enumerate(layers[:9]):
            yy = 535 - j * 13
            text(c, f'{j + 1} ' + clean(layer.get('name', layer.get('id'))), x, yy, 6.8, width=185, leading=8)
            thickness = optional_number(layer.get('thickness'))
            text(c, number(thickness * 1000 if thickness is not None else None, 2), x + 190, yy, 6.8)
            text(c, number(layer.get('lambda'), 4), x + 235, yy, 6.8)
            sd = layer.get('sd')
            if sd is None and optional_number(layer.get('mu')) is not None and thickness is not None:
                sd = optional_number(layer.get('mu')) * thickness
            text(c, number(sd, 3), x + 305, yy, 6.8)
        samples = assembly.get('samples') if isinstance(assembly.get('samples'), list) else []
        interfaces = [v for v in (assembly.get('interfaces') or []) if isinstance(v, dict)]
        profile = samples or interfaces
        self.envelope_chart(c, (430, 449, 335, 171), 'ТЕМПЕРАТУРА, °C', profile, [('temperature', 'T конструкции', BLUE)], optional_number(assembly.get('dewPointIndoor')))
        self.envelope_chart(c, (805, 449, 335, 171), 'ПАРЦИАЛЬНЫЕ ДАВЛЕНИЯ, Па', profile, [('pVapor', 'pv свободный', ORANGE), ('pSat', 'psat насыщение', GREEN)])
        top, tw = 388, 690
        text(c, 'МЕЖСЛОЙНЫЕ ГРАНИЦЫ', 43, top, 9, 'Bold', GREEN)
        headers = [('Граница', 260), ('x, мм', 75), ('T, °C', 75), ('RH, %', 75), ('pv, Па', 100), ('psat, Па', 105)]
        xx = 43; yy = top - 15
        c.setFillColor(INK); c.rect(43, yy - 21, tw, 22, fill=1, stroke=0)
        for label, cw in headers:
            text(c, label, xx + 5, yy - 13, 7, 'Bold', colors.white); xx += cw
        yy -= 22
        for j, interface in enumerate(interfaces[:9]):
            cells = [interface.get('name', interface.get('id')), number(optional_number(interface.get('x')) * 1000 if optional_number(interface.get('x')) is not None else None, 2), number(interface.get('temperature'), 2), number(interface.get('rh'), 2), number(interface.get('pVapor'), 2), number(interface.get('pSat'), 2)]
            c.setFillColor(PAPER if j % 2 == 0 else colors.white); c.rect(43, yy - 21, tw, 21, fill=1, stroke=0)
            xx = 43
            for value, (_, cw) in zip(cells, headers):
                text(c, value, xx + 5, yy - 13, 7, color=RED if finite(interface.get('rh')) > 100 else INK, width=cw - 9, leading=8)
                xx += cw
            line(c, (43, yy - 21), (43 + tw, yy - 21), LINE, .4); yy -= 21
        if len(interfaces) > 9 or len(layers) > 9:
            text(c, 'Полный состав / все границы - на следующих листах.', 43, max(125, yy - 15), 7.2, color=ORANGE)
        if not interfaces:
            text(c, 'Значения границ отсутствуют.', 50, yy - 23, 8, color=ORANGE)
        x, yy = 780, 388
        text(c, 'ОБЛАСТЬ РЕЗУЛЬТАТА', x, yy, 9, 'Bold', GREEN); yy -= 24
        state = 'Выявлен стационарный риск' if assembly.get('status') == 'risk' else 'Выбранные стационарные риски не выявлены' if assembly.get('status') == 'screen_pass' else 'Статус: ' + clean(assembly.get('status'))
        yy = text(c, state, x, yy, 10, 'Bold', ORANGE if assembly.get('status') == 'risk' else INK, width=350) - 15
        if assembly.get('targetU') is not None or assembly.get('thermalTargetStatus') is not None:
            target_color = RED if assembly.get('thermalTargetStatus') == 'fail' else GREEN
            yy = text(c, 'Принятый ориентир U: ' + number(assembly.get('targetU'), 3) + ' Вт/(м²К)\nСтатус сравнения: ' + STATUSES.get(clean(assembly.get('thermalTargetStatus')), clean(assembly.get('thermalTargetStatus'))), x, yy, 8, 'Bold', target_color, width=350) - 10
            yy = text(c, clean(assembly.get('targetUBasis') or 'Ориентир принят в проекте; его нормативная применимость и полная энергетическая оценка не подтверждены.'), x, yy, 7.2, color=MUTED, width=350) - 12
        framing = assembly.get('framingPath') or {}
        if framing:
            yy = text(c, 'Путь древесины: Tsi ' + number(framing.get('internalSurfaceTemp'), 2) + ' °C; RHsi ' + number(framing.get('surfaceRH'), 2) + ' %. Диффузия по каркасу отдельно не подтверждена.', x, yy, 8, width=350) - 13
        text(c, 'Это НЕ годовой расчёт. Не вычислены накопление и высыхание влаги, дождь, солнечный нагрев, конвективный перенос и реальные 2D/3D мостики холода.\n\nТочка росы относится к воздуху помещения и не является неподвижным слоем стены. Превышение pv над psat - индикатор риска, не масса конденсата.', x, yy, 8.5, color=MUTED, width=350)
        if assembly.get('targetU') is not None:
            source = assembly.get('targetUSource') or ''
            if isinstance(source, dict): source = source.get('url') or ''
            text(c, 'Ориентир U: ' + clean(assembly.get('targetUBasis') or 'значение из исходного проекта') + (' · ' + source if source else '') + ' · нормативная применимость не подтверждена.', 43, 123, 7.2, color=MUTED, width=W - 90)
            if source.startswith(('https://', 'http://')): c.linkURL(source, (43, 118, W - 43, 132), relative=0, thickness=0)
        self.note(c, 'Графики построены по переданным samples/interfaces; свойства материалов и граничные условия приняты из отчёта. Полные проверки, допущения и источники - следом.', y=105, color=ORANGE)

    def draw_table(self, c, data, index):
        columns, rows, size = data
        widths = [(W - 84) * col[1] for col in columns]
        # Normalize widths to protect against rounding or caller weights > 1.
        factor = (W - 84) / sum(widths)
        widths = [v * factor for v in widths]
        x, top = 42, H - 126
        c.setFillColor(INK); c.rect(x, top - 27, W - 84, 27, fill=1, stroke=0)
        xx = x
        for col, width in zip(columns, widths):
            text(c, col[0], xx + 6, top - 15, size, 'Bold', colors.white, width=width - 12)
            xx += width
        y = top - 27
        for j, (row, rh) in enumerate(rows):
            if j % 2 == 0:
                c.setFillColor(PAPER); c.rect(x, y - rh, W - 84, rh, fill=1, stroke=0)
            xx = x
            for i, (cell, width) in enumerate(zip(row, widths)):
                font = 'Mono' if columns[i][2:] and columns[i][2] == 'mono' else 'Body'
                color = RED if 'Не выполнено' in clean(cell) else ORANGE if 'Не проверено' in clean(cell) else INK
                text(c, cell, xx + 6, y - 12, size, font, color, width=width - 12, leading=size * 1.25)
                xx += width
            line(c, (x, y - rh), (W - 42, y - rh), LINE, .4)
            y -= rh
        if not rows:
            text(c, 'Данные отсутствуют в исходном отчёте.', 48, y - 24, 9, color=ORANGE)

    def draw_partgroups(self, c, data, index):
        self.draw_table(c, data, index)
        columns, rows, size = data
        groups = {g.get('id'): g for g in self.part_groups}
        y = H - 153
        width = (W - 84) * columns[0][1] - 17
        for row, rh in rows:
            group = groups.get(clean(row[0]).strip(), {})
            shape = group.get('geometry') or {}
            x, yy = 49, y - 24
            skew_a = 4 if (shape.get('cutStart') or {}).get('scheme') == 'miter' else 0
            skew_b = 4 if (shape.get('cutEnd') or {}).get('scheme') == 'miter' else 0
            profile = (shape.get('shape') or {}).get('points') if (shape.get('shape') or {}).get('type') in ('stairStringer', 'rippedBoard') else None
            if profile:
                a, b, d, e = bounds([tuple(p[:2]) for p in profile])
                polygon(c, [(x + (p[0] - a) / max(1e-9, d - a) * width, yy + (p[1] - b) / max(1e-9, e - b) * 14) for p in profile], WOOD, WOOD_DARK, .5)
            else:
                polygon(c, [(x, yy), (x + width, yy), (x + width - skew_b, yy + 6), (x + skew_a, yy + 6)], WOOD, WOOD_DARK, .5)
            length = max(.0001, finite(group.get('cutLength')))
            for end_key, at_start in [('cutStart', True), ('cutEnd', False)]:
                end = shape.get(end_key) or {}
                lap = min(width, max(0, finite(end.get('lapLength')) / length * width))
                if end.get('scheme') in ('halfLap', 'half-lap') and lap > 0:
                    lx = x if at_start else x + width - lap
                    ly = yy + 3 if end.get('lapSide') == 'top' else yy
                    c.setFillColor(colors.white); c.setStrokeColor(WOOD_DARK); c.rect(lx, ly, lap, 3, fill=1, stroke=1)
                elif end.get('scheme') == 'scarf' and lap > 0:
                    edge = x if at_start else x + width
                    inner = edge + lap if at_start else edge - lap
                    removed = [(edge, yy), (edge, yy + 6), (inner, yy + 6)] if end.get('lapSide') == 'top' else [(edge, yy), (edge, yy + 6), (inner, yy)]
                    polygon(c, removed, colors.white, WOOD_DARK, .5)
            for notch in shape.get('notches') or []:
                points = notch.get('polygon') or []
                stations = [p[0] for p in points if isinstance(p, list) and len(p) >= 3]
                if stations:
                    a, b = min(stations), max(stations)
                    c.setFillColor(RED); c.rect(x + max(0, a / length) * width, yy + 2, max(1, min(1, b / length) * width - max(0, a / length) * width), 4, fill=1, stroke=0)
            y -= rh

    def draw_estimate(self, c, data, index):
        x, y = 55, H - 155
        text(c, 'ИТОГО ПО ОТЧЁТУ', x, y, 12, 'Bold', GREEN)
        text(c, number(self.estimate.get('total'), 2) + ' ' + self.unit_money, x, y - 58, 36, 'Bold')
        y -= 123
        for key, label in [('materialTotal', 'Материалы'), ('laborTotal', 'Работы'), ('reserve', 'Резерв')]:
            text(c, label, x, y, 13, color=MUTED)
            text(c, number(self.estimate.get(key), 2) + ' ' + self.unit_money, x + 270, y, 15, 'Bold')
            line(c, (x, y - 14), (x + 580, y - 14)); y -= 58
        x, y = 730, H - 155
        text(c, 'ЗАКУПКА ДРЕВЕСИНЫ', x, y, 11, 'Bold', GREEN)
        text(c, number(self.estimate.get('procurementTimberVolume'), 4) + ' м³', x, y - 42, 23, 'Bold')
        y = text(c, 'Объём закупки из реальных исходных досок 6 м. Процентный запас поверх готовой карты раскроя не добавляется, если это указано в строке сметы.', x, y - 78, 10, width=350) - 25
        for note in self.estimate.get('assumptions') or []:
            y = text(c, '• ' + clean(note), x, y, 8.5, width=350) - 15
        self.note(c, 'Цены и валюта из исходного проекта. Доставка, налоги, техника, разрешения и работы включены только при наличии соответствующих строк.', y=115)

    def draw_cutsummary(self, c, data, index):
        s = self.cut.get('summary') or {}
        x, y = 43, H - 142
        text(c, 'СТРОГО ИСХОДНЫЕ ДОСКИ 6 000 ММ', x, y, 14, 'Bold', GREEN)
        y -= 39
        for label, value in [('Досок закупки / физических деталей', f'{s.get("boards", len(self.cut.get("stocks", [])))} / {s.get("pieces", len(self.members))}'), ('Объём закупки', number(s.get('purchasedVolume'), 4) + ' м³'), ('Объём заготовок', number(s.get('usedVolume'), 4) + ' м³'), ('Отходы всего', number(s.get('wasteVolume'), 4) + ' м³ / ' + number(s.get('wastePercent'), 2) + ' %'), ('Пригодные остатки · суммарная длина', number(s.get('reusableLength'), 3) + ' м'), ('Потеря на пропил', number(s.get('kerfLoss'), 3) + ' м'), ('Нижняя граница количества досок', clean(s.get('lowerBound'))), ('Продольные соединения', clean(s.get('spliceCount')))]:
            text(c, label, x, y, 9, color=MUTED); text(c, value, x + 355, y, 10, 'Bold'); y -= 34
        left_notes_y = y - 18
        x, y = 690, H - 142
        text(c, 'ПРАВИЛА РАСКРОЯ', x, y, 11, 'Bold', GREEN); y -= 28
        rules = [f'Ширина пропила {number(self.cut.get("kerfMM", 3), 1)} мм, только между соседними деталями. Торцевание исходной доски не заложено.', 'Позиции от начала исходной доски: 0–6 000 мм. Заготовка может быть длиннее оси элемента из-за припусков и нахлёстов.', 'Угол торца отсчитывается от прямого поперечного реза. Уклон элемента в здании не является углом пилы.', 'A / B - начальный и конечный торцы исходной детали. «Верх/низ» - сторона выборки по данным модели.', 'Полный ID физической детали связывает карту раскроя со спецификацией и JSON-отчётом.', 'Остаток считается пригодным для повторного использования только по порогу движка. Его наличие не подтверждает новый раскрой.', 'Оптимальность доказана по количеству досок в принятой модели пропила.' if s.get('optimal') else 'Найденная раскладка. Глобальная оптимальность количества досок не доказана.', 'Крепёж и несущая способность продольных соединений требуют отдельного расчёта.']
        for rule in rules:
            y = text(c, '• ' + rule, x, y, 9, width=440) - 12
        text(c, 'ДОПУЩЕНИЯ ДВИЖКА', 43, left_notes_y, 8, 'Bold', GREEN)
        left_notes_y -= 20
        for note in self.cut.get('assumptions') or []:
            if left_notes_y < 135:
                break
            left_notes_y = text(c, clean(note), 43, left_notes_y, 7.8, color=MUTED, width=560) - 7
        self.note(c, 'Далее приведены все повторяемые схемы с количеством исходных досок. Каждая деталь и stock ID точно сопоставлены группам во внешних CSV и JSON.', y=107, color=GREEN)

    def draw_cutcards(self, c, cards, index):
        w, h = (W - 112) / 2, 297
        positions = [(43, H - 425), (69 + w, H - 425), (43, H - 738), (69 + w, H - 738)]
        for (stock, offset, pieces), (x, y) in zip(cards or [], positions):
            c.setFillColor(PAPER); c.setStrokeColor(LINE); c.roundRect(x, y, w, h, 5, fill=1, stroke=1)
            text(c, clean(stock.get('id')), x + 13, y + h - 22, 12, 'Mono', GREEN)
            text(c, f'{stock.get("b")} × {stock.get("h")} мм · 6 000 мм' + (' · ПРОДОЛЖЕНИЕ' if offset else ''), x + 112, y + h - 22, 9, 'Bold')
            text(c, f'Заготовки {number(stock.get("used"), 3)} м  ·  пропил {number(stock.get("kerfWaste"), 3)} м  ·  остаток {number(stock.get("remainder"), 3)} м', x + 13, y + h - 42, 7.2, color=MUTED)
            bx, by, bw = x + 14, y + h - 83, w - 28
            c.setFillColor(colors.HexColor('#e1e5df')); c.rect(bx, by, bw, 27, fill=1, stroke=0)
            for j, p in enumerate(stock.get('pieces') or []):
                start = finite(p.get('cutStart', p.get('start')))
                end = finite(p.get('cutEnd', p.get('end')), start + finite(p.get('length')))
                sx, ex = bx + start / 6 * bw, bx + end / 6 * bw
                c.setFillColor(WOOD if j % 2 == 0 else LIME); c.setStrokeColor(colors.white); c.rect(sx, by, max(.2, ex - sx), 27, fill=1, stroke=1)
                if ex - sx > 27:
                    text(c, str(j + 1), sx + 3, by + 10, 7, 'Bold')
                if j < len(stock.get('pieces') or []) - 1:
                    line(c, (ex, by), (ex, by + 27), RED, 1)
            text(c, '0', bx, by - 11, 6, 'Mono', MUTED)
            text(c, '6 000 мм', bx + bw - 43, by - 11, 6, 'Mono', MUTED)
            yy = by - 29
            text(c, '№ / МАРКА / ПОЛНЫЙ ID ДЕТАЛИ', x + 13, yy, 6.2, 'Bold', MUTED)
            text(c, 'ОТ–ДО / ДЛИНА, ММ', x + w - 170, yy, 6.2, 'Bold', MUTED)
            yy -= 15
            for j, p in enumerate(pieces):
                sourceid = clean(p.get('sourceId', p.get('id')))
                mark = self.marks.get(sourceid, self.marks.get(str(p.get('id')), '-'))
                start = finite(p.get('cutStart', p.get('start')))
                end = finite(p.get('cutEnd', p.get('end')), start + finite(p.get('length')))
                text(c, f'{offset + j + 1:02d} {mark}', x + 13, yy, 6.5, 'Mono')
                text(c, sourceid, x + 83, yy, 6.4, 'Mono', width=w - 260)
                text(c, f'{number(start * 1000, 1)}–{number(end * 1000, 1)} / {number(finite(p.get("length")) * 1000, 1)}', x + w - 170, yy, 6.5, 'Mono')
                ends = self.ends(p.get('endStart', (p.get('source') or {}).get('cutStart')), p.get('endEnd', (p.get('source') or {}).get('cutEnd')))
                text(c, ends, x + 83, yy - 10, 6.2, color=MUTED, width=w - 100)
                yy -= 22
            if len(pieces) < 8:
                text(c, 'Остаток: ' + ('для повторного использования' if stock.get('reusable') else 'короткий / не отнесён к пригодным'), x + 13, y + 10, 6.5, color=GREEN if stock.get('reusable') else MUTED)

    def draw_patterncards(self, c, cards, index):
        w, h = (W - 112) / 2, 198
        for card_index, (pattern, offset, pieces) in enumerate(cards or []):
            x = 43 + (card_index % 2) * (w + 26)
            y = H - 116 - h - (card_index // 2) * (h + 12)
            c.setFillColor(PAPER); c.setStrokeColor(LINE); c.roundRect(x, y, w, h, 5, fill=1, stroke=1)
            text(c, pattern.get('id'), x + 12, y + h - 20, 12, 'Mono', GREEN)
            text(c, '× ' + clean(pattern.get('count')) + ' шт.', x + 98, y + h - 20, 11, 'Bold')
            text(c, clean(pattern.get('section')) + ' мм · 6 000 мм' + (' · продолжение' if offset else ''), x + 250, y + h - 20, 8, 'Bold')
            text(c, 'Пропил ' + number(pattern.get('kerfWaste'), 3) + ' м · остаток ' + number(pattern.get('remainder'), 3) + ' м на доску', x + 12, y + h - 38, 7.4, color=MUTED)
            bx, by, bw = x + 12, y + h - 68, w - 24
            c.setFillColor(colors.HexColor('#e1e5df')); c.rect(bx, by, bw, 18, fill=1, stroke=0)
            for j, p in enumerate(pattern.get('pieces') or []):
                sx = bx + finite(p.get('start')) / 6 * bw
                ex = bx + finite(p.get('end')) / 6 * bw
                c.setFillColor(WOOD if j % 2 == 0 else LIME); c.setStrokeColor(colors.white); c.rect(sx, by, max(.2, ex - sx), 18, fill=1, stroke=1)
                if ex - sx > 39:
                    text(c, p.get('partGroupId'), sx + 3, by + 6, 7, 'Mono')
                elif ex - sx > 10:
                    text(c, j + 1, sx + 2, by + 6, 6.5, 'Bold')
                if j < len(pattern.get('pieces') or []) - 1:
                    line(c, (ex, by), (ex, by + 18), RED, .8)
            yy = by - 16
            text(c, '№ / ГРУППА', x + 12, yy, 6.8, 'Bold', MUTED)
            text(c, 'НАЧАЛО → КОНЕЦ, ММ', x + 150, yy, 6.8, 'Bold', MUTED)
            text(c, 'ДЛИНА, ММ', x + w - 92, yy, 6.8, 'Bold', MUTED)
            yy -= 15
            for j, piece in enumerate(pieces):
                text(c, f'{offset + j + 1:02d}  {clean(piece.get("partGroupId"))}', x + 12, yy, 7.5, 'Mono')
                text(c, number(finite(piece.get('start')) * 1000, 1) + ' → ' + number(finite(piece.get('end')) * 1000, 1), x + 150, yy, 7.5, 'Mono')
                text(c, number(finite(piece.get('length')) * 1000, 1), x + w - 92, yy, 7.5, 'Mono')
                yy -= 14
            ids = 'Исходные: ' + self.compressed_ids(pattern.get('stockIds'))
            if len(wrap(ids, w - 24, 'Body', 7)) > 2:
                ids = f'Все {pattern.get("count")} stock ID: fabrication-stocks.csv / JSON.'
            text(c, ids, x + 12, y + 21, 7, color=MUTED, width=w - 24, leading=9)


def main():
    parser = argparse.ArgumentParser(description='КАРКАС ENGINE: A3 landscape structural calculation album')
    parser.add_argument('report', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--assets-dir', type=Path)
    args = parser.parse_args()
    register_fonts(args.assets_dir)
    with args.report.open('r', encoding='utf-8') as source:
        report = json.load(source)
    if not isinstance(report, dict) or not isinstance(report.get('result'), dict):
        parser.error('Ожидается отчёт {engine, project, result, cutting, estimate, planning}.')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    album = Album(report)
    pages = album.render(args.output)
    print(json.dumps({'ok': True, 'output': str(args.output.resolve()), 'pages': pages, 'stocks': len(album.cut.get('stocks', [])), 'members': len(album.members), 'revision': album.engine.get('revision'), 'hash': album.engine.get('hash')}, ensure_ascii=False))


if __name__ == '__main__':
    main()
