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
ROLE.update({'topChord': 'Стропило / верхний пояс', 'bottomChord': 'Нижняя затяжка', 'collarTie': 'Верхний ригель', 'kneePost': 'Внутренний подкос', 'ceilingHanger': 'Подвес потолка', 'ceilingLedger': 'Пристенная опора потолка', 'ceilingBatten': 'Брусок потолка'})
ROLE['wallTransferBlocking'] = 'Поперечная вставка под стеной'
WALL_REINFORCEMENT = colors.HexColor('#963b70')


class Album:
    def __init__(self, report):
        self.report = report
        self.p = report.get('project') or {}
        self.r = report.get('result') or {}
        self.engine = report.get('engine') or {}
        self.release = clean(self.engine.get('version', '4.0'))
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
        self.foundation_shared = bool(self.gr.get('sharedAnnexIds') or (self.r.get('foundation') or {}).get('sharedGrillage'))
        self.support_nodes = self.select_support_nodes()
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
        self.add('Ростверк · монтажный план общей рамы' if self.foundation_shared else 'Ростверк · монтажный план', 'grillage', subtitle='Фактические доски пакетов, опоры и поперечные связи. Размеры между опорными осями в мм; отметки в м.')
        if self.support_nodes:
            self.add('Ростверк · опорные сопряжения общей рамы', 'supportnodes', self.support_nodes, 'У-марки привязаны к узлам монтажного плана. Показаны фактические тела и отметки; крепёж и передача усилий через узел не рассчитаны.')
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
            self.add(f'Перекрытие этажа {level.get("index", 1)} · монтажный план лаг', 'floorframing', level, 'Фактические лаги, обвязка, распорки и опорные линии. Марки FG связывают план с ведомостью и полной картой 6 м.')
            supports = self.wall_support_records(level)
            if supports:
                for j, table_supports in enumerate(self.wall_support_chunks(supports)):
                    self.add(f'Опирание стен на платформу · этаж {level.get("index", 1)}' + (' · продолжение' if j else ''), 'wallsupportplan', {'level': level, 'supports': supports, 'tableSupports': table_supports}, 'Оси и основания стен поверх фактических лаг и вставок. Геометрическое покрытие не подтверждает несущую способность и соединения.')
                nodes = self.wall_support_nodes(supports)
                if nodes:
                    self.add('Стены и платформа · фактические узлы опирания', 'wallsupportnodes', nodes, 'Вдоль и поперёк лаг. Условный настил 35 мм сохраняется между каркасом пола и нижней обвязкой стены; его материал и несущая способность не заданы.')
        wall_transfers = (self.r.get('floorPlatform') or {}).get('wallLoadTransfers') or {}
        if isinstance(wall_transfers, dict):
            load_rows = self.wall_load_rows(wall_transfers)
            if load_rows:
                self.table_pages('Перегородки · собственный вес и путь нагрузки', [('Стена', .13), ('Ориентация', .12), ('Древесина / слои, кН', .17), ('Исходная / переданная сила, кН', .2), ('Невязка силы, кН', .14), ('Передача', .24)], load_rows, 'Только собственный вес ненесущих перегородок первого этажа. Это не проверка передачи несущих стен, кровли или снега. Крепёж и распределение через условный настил не подтверждены.', 8)
                control = self.floor_joist_control()
                if control:
                    page = self.pages[-1]; page['kind'] = 'wallloads'; page['data'] = {'table': page['data'], 'control': control}
            transfer_rows = self.wall_transfer_rows(wall_transfers)
            if transfer_rows:
                self.table_pages('Вставки под стенами · частные проверки по FG', [('FG / число', .1), ('Стены', .14), ('Контроль по η · ID', .18, 'mono'), ('max |M|, кН·м', .1), ('max |V|, кН', .1), ('f / flim, мм', .13), ('max η', .1), ('Результат доски', .15)], transfer_rows, 'Огибающие по фактическим вставкам каждой FG: max M, V и f/flim могут относиться к разным доскам. В контрольном ID указан максимум η. Секции работают отдельно; торцевой крепёж и эксцентричная передача на лаги не рассчитаны.', 7.8)
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
        partition_heads = self.partition_head_details()
        for i in range(0, len(partition_heads), 6):
            self.add('Перегородки · верхнее примыкание и холодный чердак', 'partitionheads', partition_heads[i:i + 6], 'Фактические доски, целевые отметки и принятый зазор. Скользящее крепление, боковое удержание и герметизация не рассчитаны.')
        plate_corners = self.plate_corner_details()
        for i in range(0, len(plate_corners), 2):
            self.add('Углы стен · фактические слои обвязки', 'platecorners', plate_corners[i:i + 2], 'Планы физических досок: нижняя обвязка, два верхних слоя. Фрагменты по месту; марки FG связывают детали с раскроем и CSV.')
        self.add('Кровля · план зон и сток', 'roofplan')
        zones = self.roof.get('zones') or []
        for i in range(0, len(zones), 2):
            self.add('Кровля · несущие схемы и разрезы', 'roofsections', zones[i:i + 2], 'Показана геометрия фактических элементов. Опорные узлы и крепёж не подтверждены.')
        for zone in zones:
            frame = zone.get('frameAnalysis')
            if not isinstance(frame, dict):
                continue
            zone_name = clean(zone.get('name', zone.get('id')))
            collar = self.collar_lap_detail(zone)
            if collar:
                self.add('Кровля · накладной ригель · контакт широких граней', 'collarlap', collar, zone_name + '. Фактическая геометрия выбранной рамы. Нахлёст расположен сбоку; крепёж и пространственная работа соединения не подтверждены.')
            force_rows = self.roof_frame_force_rows(zone)
            if force_rows:
                self.table_pages('Кровля · рамный расчёт 2D · усилия и прогибы', [('Участок / назначение', .23), ('Сечение, мм', .09), ('L оси, м', .07), ('|N|max, кН', .085), ('|V|max, кН', .085), ('|M|max, кНм', .09), ('δверт / δlim, мм', .12), ('η', .07), ('Статус', .16)], force_rows, zone_name + '. Усилия - расчётная нагрузка; вертикальный прогиб - эксплуатационная. Огибающие N/V/M не обязательно одновременны. Заготовки - по FG / раскрою.', 7.4)
            self.table_pages('Кровля · рамный расчёт 2D · модель и жёсткости', [('Параметр / группа участков', .3), ('Данные расчётной модели', .7)], self.roof_frame_model_rows(zone), zone_name + '. Жёсткости и освобождения воспроизведены из расчёта; жёсткость реального крепёжного узла ими не подтверждается.', 7.6)
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
        profile = shape.get('points') if shape.get('type') in ('stairStringer', 'rippedBoard', 'rafterSeats') else None
        def cut_station(station, height, width):
            for key, at_start in [('cutStart', True), ('cutEnd', False)]:
                cut = m.get(key) or {}
                boundary = -length / 2 if at_start else length / 2
                if cut.get('scheme') != 'miter' or abs(station - boundary) > 1e-5:
                    continue
                tangent = math.tan(math.radians(finite(cut.get('angle')))) * finite(cut.get('tiltSign'), 1)
                station += width * tangent if cut.get('plane') == 'width' else height * tangent * (1 if at_start else -1)
            return station
        if profile:
            outline = [project(tuple(center[i] + u[i] * cut_station(finite(p[0]), finite(p[1]), 0) + depth[i] * finite(p[1]) for i in range(3))) for p in profile]
            area = abs(sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(outline, outline[1:] + outline[:1]))) / 2
            width_ends = [project(tuple(center[i] + cross[i] * side * finite(m.get('b')) / 2000 for i in range(3))) for side in (-1, 1)]
            if area > 1e-10 or math.dist(*width_ends) < 1e-10:
                return outline
            # A plan normal to a profile collapses its depth, but retains the
            # real extrusion width; do not turn a 75 mm rafter into a centreline.
            points = sorted(set(project(tuple(center[i] + u[i] * cut_station(finite(p[0]), finite(p[1]), width) + depth[i] * finite(p[1]) + cross[i] * width for i in range(3))) for p in profile for width in (-finite(m.get('b')) / 2000, finite(m.get('b')) / 2000)))
        else:
            # Convex hull of the actual rectangular section's eight projected corners.
            points = sorted(set(project(tuple(center[i] + u[i] * cut_station(s, h, w) + depth[i] * h + cross[i] * w for i in range(3))) for s in (-length / 2, length / 2) for h in (-finite(m.get('h')) / 2000, finite(m.get('h')) / 2000) for w in (-finite(m.get('b')) / 2000, finite(m.get('b')) / 2000)))
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

    def plate_corner_details(self):
        """Use explicit engine joint metadata; never synthesize corrected plate ends."""
        details = []
        for corner in self.r.get('corners') or []:
            if corner.get('kind') != 'corner' or corner.get('point') is None:
                continue
            records = []
            for member in self.members:
                if member.get('role') != 'plate' or not member.get('start') or not member.get('end'):
                    continue
                position = member.get('platePosition'); layer = member.get('plateLayer')
                if position not in ('bottom', 'top') or position == 'top' and layer not in (0, 1):
                    continue
                for joint in member.get('cornerEndJoints') or []:
                    if joint.get('cornerId') == corner.get('id'):
                        records.append({'member': member, 'joint': joint, 'position': position, 'layer': layer})
            if records:
                details.append({'corner': corner, 'records': records, 'number': len(details) + 1})
        return details

    def draw_platecorners(self, c, details, index):
        layers = [('bottom', None, 'НИЖНЯЯ ОБВЯЗКА'), ('top', 0, 'ВЕРХНЯЯ · СЛОЙ 1'), ('top', 1, 'ВЕРХНЯЯ · СЛОЙ 2')]
        for row, detail in enumerate(details or []):
            corner, records = detail['corner'], detail['records']
            x, y, w, h = 43, H - 421 - row * 312, W - 86, 294
            c.setStrokeColor(LINE); c.rect(x, y, w, h, fill=0, stroke=1)
            names = [self.wall_names.get(str(wid), clean(wid)) for wid in corner.get('wallIds') or []]
            sections = list(dict.fromkeys(str(r['member'].get('b')) + ' × ' + str(r['member'].get('h')) + ' мм' for r in records))
            text(c, 'Угол ' + str(detail['number']) + ' · этаж ' + clean(corner.get('level')) + ' · ' + ' / '.join(names) + ' · ' + '; '.join(sections), x + 12, y + h - 21, 10.5, 'Bold', GREEN)
            point = xy(corner['point'])
            text(c, clean(corner.get('id')) + ' · оси X=' + number(point[0], 3) + ' / Y=' + number(point[1], 3) + ' м', x + 12, y + h - 39, 6.8, 'Mono', MUTED)
            wall_ids = sorted(corner.get('wallIds') or [])
            wall_colors = {wid: (WOOD_DARK if j == 0 else GREEN) for j, wid in enumerate(wall_ids)}
            depth = max([finite(r['member'].get('h')) / 1000 for r in records] or [.15])
            radius = max(.25, depth * 2)
            for column, (position, layer, title) in enumerate(layers):
                xx = x + 12 + column * 231
                text(c, title, xx, y + h - 62, 8, 'Bold')
                card = (xx, y + 53, 215, 161)
                fn, scale = transform([(point[0] - radius, point[1] - radius), (point[0] + radius, point[1] + radius)], card, 12)
                current = [r for r in records if r['position'] == position and (position == 'bottom' or r['layer'] == layer)]
                c.saveState(); clip = c.beginPath(); clip.rect(*card); c.clipPath(clip, stroke=0)
                for wid in wall_ids:
                    wall = self.wall_map.get(str(wid)) or {}
                    if wall.get('a') is not None and wall.get('b') is not None:
                        line(c, fn(xy(wall['a'])), fn(xy(wall['b'])), BLUE, .45, [4, 3])
                for record in current:
                    member = record['member']; wid = record['joint'].get('wallId', member.get('wallId'))
                    color = wall_colors.get(wid, INK)
                    shape = self.projected_member(member, lambda q: (q[0], q[2]))
                    polygon(c, [fn(p) for p in shape], colors.HexColor('#eee0c6') if color == WOOD_DARK else colors.HexColor('#e1e9d9'), color, .95)
                c.restoreState()
                center = fn(point); line(c, (center[0] - 4, center[1]), (center[0] + 4, center[1]), BLUE, .55); line(c, (center[0], center[1] - 4), (center[0], center[1] + 4), BLUE, .55)
                if current:
                    marks = list(dict.fromkeys(self.marks.get(str(r['member'].get('id')), '-') for r in current))
                    elevation = min(xyz(r['member']['start'])[1] - finite(r['member'].get('b')) / 2000 for r in current)
                    text(c, ' / '.join(marks) + ' · низ +' + number(elevation, 3) + ' м', xx, y + 34, 7.2, 'Mono', width=215)
                else:
                    text(c, 'Метаданные слоя не переданы.', xx, y + 34, 7.2, color=ORANGE, width=215)
            tx, ty, tw = x + 713, y + h - 62, w - 727
            text(c, 'ДОСКИ И ТОРЦЫ ПО МОДЕЛИ', tx, ty, 8, 'Bold', GREEN); ty -= 19
            columns = [('Слой / FG', .24), ('Стена / торец', .26), ('Стык / Δ, мм', .28), ('Lзаг, мм', .22)]
            c.setFillColor(INK); c.rect(tx, ty - 24, tw, 24, fill=1, stroke=0)
            left = tx
            for label, fraction in columns:
                text(c, label, left + 4, ty - 15, 6.4, 'Bold', colors.white); left += tw * fraction
            ty -= 24
            ordered = sorted(records, key=lambda r: (0 if r['position'] == 'bottom' else 1 + int(r['layer']), str(r['joint'].get('wallId')), str(r['member'].get('id'))))
            for i, record in enumerate(ordered[:7]):
                member, joint = record['member'], record['joint']; wid = joint.get('wallId', member.get('wallId'))
                color = wall_colors.get(wid, INK)
                layer_name = 'Низ' if record['position'] == 'bottom' else 'Верх ' + str(int(record['layer']) + 1)
                joint_name = 'Проходная' if joint.get('through') is True else 'Встык' if joint.get('through') is False else '-'
                values = [layer_name + ' / ' + self.marks.get(str(member.get('id')), '-'), self.wall_names.get(str(wid), clean(wid)) + ' / ' + {'start': 'A', 'end': 'B'}.get(joint.get('end'), '-'), joint_name + ' / ' + number(finite(joint.get('offset')) * 1000, 1), number(finite(member.get('cutLength', member.get('length'))) * 1000, 0)]
                c.setFillColor(PAPER if i % 2 == 0 else colors.white); c.rect(tx, ty - 23, tw, 23, fill=1, stroke=0)
                left = tx
                for value, (_, fraction) in zip(values, columns):
                    text(c, value, left + 4, ty - 14, 6.6, color=color, width=tw * fraction - 7); left += tw * fraction
                ty -= 23
            if len(ordered) > 7:
                text(c, 'Остальные физические детали и торцы - CSV / JSON.', tx, ty - 12, 6.7, color=MUTED, width=tw)
            text(c, 'Δ - смещение торца относительно конца оси стены: «−» выпуск, «+» отступ. Цвет соответствует стене. Размеры сечений и торцы - в ведомости FG.', tx, y + 37, 6.9, color=MUTED, width=tw)
            text(c, 'Фрагменты планов обрезаны границами окон показа; это не дополнительные распилы досок.', x + 12, y + 14, 6.9, color=MUTED)
        self.note(c, 'Геометрия слоёв воспроизведена из физических досок отчёта. Перекрытие стыков не подтверждает крепёж, пространственную работу, непрерывность плёнок и герметичность узла.', y=100, color=ORANGE)

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

    def select_support_nodes(self):
        beams = {b.get('id'): b for b in self.gr.get('beams') or []}
        candidates = [j for j in self.gr.get('joints') or [] if j.get('type') == 'node' and j.get('point') and len(j.get('beamIds') or []) > 1]
        selected = []
        for wanted, title in [('shared', 'Общая рама дома и веранды'), ('cross', 'Поперечная связь на опоре')]:
            for joint in candidates:
                kinds = [set(beams.get(bid, {}).get('kinds') or [beams.get(bid, {}).get('kind')]) for bid in joint.get('beamIds') or []]
                is_shared = any('annexConnector' in k for k in kinds) and any('perimeter' in k or 'floorSupport' in k for k in kinds)
                is_cross = any('transverseTie' in k for k in kinds) and any('floorSupport' in k for k in kinds) and not any('annexConnector' in k for k in kinds) and not joint.get('annexIds')
                if (wanted == 'shared' and is_shared or wanted == 'cross' and is_cross) and not any(v.get('id') == joint.get('id') for v in selected):
                    selected.append({**joint, 'mark': 'У' + str(len(selected) + 1), 'title': title}); break
        return selected

    def technical_base(self, c, box, level=None, pile_grid=False):
        level = level or (self.levels[0] if self.levels else {})
        polygons = [self.platform_polygon(level)]
        if int(level.get('index', 1)) == 1:
            polygons += [[xy(p) for p in a.get('polygon') or []] for a in self.annexes]
        piles = self.r.get('piles') or []
        points = [p for poly in polygons for p in poly]
        if pile_grid: points += [xy(p) for p in piles]
        fn, scale = transform(points, box, 69)
        for poly in polygons:
            c.setDash([4, 3]); polygon(c, [fn(p) for p in poly], None, LINE, .65); c.setDash([])
        for void in self.p.get('voids') or []:
            if int(void.get('level', 2)) == int(level.get('index', 1)):
                polygon(c, [fn(xy(p)) for p in void.get('polygon') or []], colors.white, ORANGE, .6)
        axes = self.level_polygon(level)
        if pile_grid and piles:
            xs = sorted(set(round(xy(p)[0], 6) for p in piles)); ys = sorted(set(round(xy(p)[1], 6) for p in piles))
        else:
            xs = sorted(set(round(p[0], 6) for p in axes)); ys = sorted(set(round(p[1], 6) for p in axes))
        if xs and ys:
            a, b, d, e = xs[0], ys[0], xs[-1], ys[-1]
            for i, x in enumerate(xs):
                aa, zz = fn((x, b)), fn((x, e)); line(c, (aa[0], aa[1] - 17), (zz[0], zz[1] + 16), LINE, .4, [5, 4])
                c.setFillColor(colors.white); c.setStrokeColor(MUTED); c.circle(aa[0], aa[1] - 22, 7, fill=1, stroke=1); text(c, str(i + 1), aa[0] - 2.5, aa[1] - 24, 6.5)
            for i, y in enumerate(ys):
                aa, zz = fn((a, y)), fn((d, y)); line(c, (aa[0] - 17, aa[1]), (zz[0] + 16, zz[1]), LINE, .4, [5, 4])
                c.setFillColor(colors.white); c.setStrokeColor(MUTED); c.circle(aa[0] - 22, aa[1], 7, fill=1, stroke=1); text(c, chr(65 + i), aa[0] - 24.5, aa[1] - 2, 6.5)
            lower_offset = -39 if pile_grid else -39 - max(0, b - min(p[1] for p in points)) * scale
            if len(xs) > 2:
                for lo, hi in zip(xs, xs[1:]): dimension(c, fn((lo, b)), fn((hi, b)), lower_offset, number((hi - lo) * 1000, 0))
            for lo, hi in zip(ys, ys[1:]): dimension(c, fn((a, lo)), fn((a, hi)), 39, number((hi - lo) * 1000, 0))
            dimension(c, fn((a, b)), fn((d, b)), lower_offset - (23 if len(xs) > 2 else 0), number((d - a) * 1000, 0) + ' · по осям')
            dimension(c, fn((a, b)), fn((a, e)), 63, number((e - b) * 1000, 0))
        return fn, scale

    def technical_schedule(self, c, members, x, y, width, title, max_rows=18):
        text(c, title, x, y, 10, 'Bold', GREEN); y -= 24
        columns = [('Марка', .17), ('b × h', .23), ('Lзаг, мм', .24), ('Шт.', .12), ('V, м³', .24)]
        c.setFillColor(INK); c.rect(x, y - 22, width, 22, fill=1, stroke=0)
        left = x
        for label, share in columns:
            text(c, label, left + 4, y - 14, 7, 'Bold', colors.white); left += width * share
        y -= 22
        groups = collections.OrderedDict()
        for member in members:
            mark = self.marks.get(str(member.get('id')), clean(member.get('id')))
            key = (mark, member.get('b'), member.get('h'), round(finite(member.get('cutLength', member.get('length'))), 6))
            row = groups.setdefault(key, {'count': 0, 'volume': 0})
            row['count'] += 1; row['volume'] += finite(member.get('volume'))
        for i, ((mark, b, h, length), totals) in enumerate(sorted(groups.items(), key=lambda item: item[0][0])):
            if i >= max_rows:
                y = text(c, f'Ещё {len(groups) - max_rows} марок: полная ведомость FG и CSV.', x, y - 13, 7, color=ORANGE, width=width); break
            c.setFillColor(PAPER if i % 2 == 0 else colors.white); c.rect(x, y - 20, width, 20, fill=1, stroke=0)
            values = [mark, f'{b} × {h}', number(length * 1000, 0), totals['count'], number(totals['volume'], 3)]
            left = x
            for value, (_, share) in zip(values, columns):
                text(c, value, left + 4, y - 13, 7, 'Mono' if left == x else 'Body'); left += width * share
            line(c, (x, y - 20), (x + width, y - 20), LINE, .35); y -= 20
        y -= 17
        text(c, f'{len(members)} физических досок · {number(sum(finite(m.get("volume")) for m in members), 3)} м³', x, y, 8, 'Bold')
        return y - 23

    def technical_callout(self, c, label, anchor, occupied, color=INK, size=6.6):
        width = pdfmetrics.stringWidth(clean(label), 'Mono', size)
        offsets = [(13, 12), (-width - 13, 12), (13, -17), (-width - 13, -17), (25, 26), (-width - 25, -29), (13, 39)]
        for dx, dy in offsets:
            x, y = anchor[0] + dx, anchor[1] + dy
            rect = (x - 2, y - 3, x + width + 2, y + size + 2)
            if any(rect[0] < old[2] + 2 and rect[2] > old[0] - 2 and rect[1] < old[3] + 2 and rect[3] > old[1] - 2 for old in occupied): continue
            occupied.append(rect)
            elbow = (x - 3 if dx > 0 else x + width + 3, y - 2)
            line(c, anchor, elbow, color, .45); line(c, elbow, (x + width, y - 2) if dx > 0 else (x, y - 2), color, .45)
            text(c, label, x, y, size, 'Mono', color); return

    def node_mark(self, c, node, fn):
        anchor = fn(xy(node['point'])); center = (anchor[0] + 25, anchor[1] + 26)
        line(c, anchor, center, ORANGE, .8); c.setFillColor(colors.white); c.setStrokeColor(ORANGE); c.circle(*center, 9, fill=1, stroke=1)
        text(c, node['mark'], center[0] - 6, center[1] - 2.5, 7.5, 'Bold', ORANGE)

    def draw_piles(self, c, data, index):
        level = self.levels[0] if self.levels else {}
        fn, scale = self.technical_base(c, (40, 135, 850, H - 245), level, pile_grid=True)
        for beam in self.gr.get('beams') or []:
            line(c, fn(xy(beam['a'])), fn(xy(beam['b'])), BLUE, .65, [5, 3])
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
        fn, scale = self.technical_base(c, (40, 145, 775, H - 265), pile_grid=True)
        members = self.gr.get('instances') or [m for m in self.members if m.get('category') == 'foundation']
        beams = {b.get('id'): b for b in self.gr.get('beams') or []}
        occupied = []
        for pile in self.r.get('piles') or []:
            point = xy(pile); cap = finite(pile.get('capSize'), finite(self.gr.get('capSize'), 250)) / 2000
            polygon(c, [fn((point[0] - cap, point[1] - cap)), fn((point[0] + cap, point[1] - cap)), fn((point[0] + cap, point[1] + cap)), fn((point[0] - cap, point[1] + cap))], None, BLUE, .6)
        for member in members:
            beam = beams.get(member.get('beamId'), {}); kinds = beam.get('kinds') or []
            color = BLUE if 'transverseTie' in kinds or 'annexConnector' in kinds else INK
            fill = colors.HexColor('#eef3f5') if color == BLUE else colors.HexColor('#f2eee5')
            polygon(c, [fn(p) for p in self.projected_member(member, lambda q: (q[0], q[2]))], fill, color, .65)
        for pile in self.r.get('piles') or []:
            xx, yy = fn(xy(pile)); c.setFillColor(BLUE); c.circle(xx, yy, 1.8, fill=1, stroke=0)
            label = clean(pile.get('id')); tw = pdfmetrics.stringWidth(label, 'Mono', 5.4)
            text(c, label, xx + 5, yy - 10, 5.4, 'Mono', BLUE); occupied.append((xx + 3, yy - 12, xx + tw + 7, yy - 3))
        for beam in beams.values():
            a, b = xy(beam.get('a')), xy(beam.get('b')); length = math.dist(a, b)
            if length < 1e-8: continue
            anchor = fn((a[0] + (b[0] - a[0]) * .37, a[1] + (b[1] - a[1]) * .37))
            color = BLUE if 'transverseTie' in (beam.get('kinds') or []) else INK
            self.technical_callout(c, beam.get('id'), anchor, occupied, color, 7)
        marked = set()
        for member in members:
            mark = self.marks.get(str(member.get('id')))
            if not mark or mark in marked: continue
            marked.add(mark); a, b = xy(member.get('start')), xy(member.get('end'))
            self.technical_callout(c, mark, fn(((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)), occupied, WOOD_DARK, 6.4)
        for node in self.support_nodes: self.node_mark(c, node, fn)
        x, y = 850, H - 144
        y = self.technical_schedule(c, members, x, y, 292, 'ДОСКИ ОБЩЕГО РОСТВЕРКА' if self.foundation_shared else 'ДОСКИ РОСТВЕРКА')
        ties = [b for b in beams.values() if 'transverseTie' in (b.get('kinds') or [])]
        text(c, 'СХЕМА И МАРКИ', x, y, 9, 'Bold', GREEN); y -= 22
        for label, color in [('Пакеты продольных балок', INK), ('Поперечные связи / продолжения к веранде', BLUE), ('Оголовки и общие IDs свай', BLUE), ('FG - геометрия отдельной доски', WOOD_DARK)]:
            line(c, (x, y + 3), (x + 17, y + 3), color, 1.5); y = text(c, label, x + 24, y, 7.4, color=color, width=267) - 12
        y = text(c, f'{len(beams)} балок · {len(ties)} поперечных связей · {len(self.r.get("piles") or [])} опор.\nОбщий габарит дома по наружным граням каркаса - по архитектурному плану; на этом листе размеры между опорными осями.', x, y - 5, 7.5, width=292) - 20
        y = text(c, 'Низ пакета / оголовки +' + number(self.gr.get('pileHeadY'), 3) + ' м\nВерх общего ростверка +' + number(self.gr.get('topY'), 3) + ' м', x, y, 8, 'Bold', width=292) - 18
        text(c, 'У1 / У2 - фактические опорные сопряжения на следующем листе. Сборка пакетов, крепёж, анкеры и смятие в узлах требуют расчёта.', x, y, 7.6, color=ORANGE, width=292)
        self.note(c, 'Каждая линия доски - фактический физический элемент. Стыки показаны торцами досок; их подробная раскладка по слоям - далее. Одна общая рама и один реестр опор дома и присоединённой веранды.' if self.foundation_shared else 'Каждая линия доски - фактический физический элемент. Стыки показаны торцами досок; подробная раскладка по слоям - далее.', y=103)

    def draw_supportnodes(self, c, nodes, index):
        beams = {b.get('id'): b for b in self.gr.get('beams') or []}; piles = {p.get('id'): p for p in self.r.get('piles') or []}
        def segment_distance(point, a, b):
            d = (b[0] - a[0], b[1] - a[1]); length2 = d[0] ** 2 + d[1] ** 2
            t = max(0, min(1, ((point[0] - a[0]) * d[0] + (point[1] - a[1]) * d[1]) / max(1e-12, length2)))
            return math.dist(point, (a[0] + t * d[0], a[1] + t * d[1]))
        for i, node in enumerate(nodes or []):
            x, y, w, h = 43 + i * 567, 155, 535, 545
            c.setStrokeColor(LINE); c.rect(x, y, w, h, fill=0, stroke=1)
            text(c, node['mark'] + ' · ' + node['title'], x + 13, y + h - 24, 11, 'Bold', GREEN, width=w - 26)
            text(c, clean(node.get('id')) + ' · ' + clean(node.get('pileId')) + ' · ' + ' / '.join(node.get('beamIds') or []), x + 13, y + h - 45, 7, 'Mono', MUTED, width=w - 26)
            point = xy(node['point']); radius = .44
            members = [m for m in self.gr.get('instances') or [] if m.get('beamId') in (node.get('beamIds') or []) and segment_distance(point, xy(m.get('start')), xy(m.get('end'))) < radius]
            pile = piles.get(node.get('pileId'), {}); cap = finite(pile.get('capSize'), finite(self.gr.get('capSize'), 250)) / 1000
            text(c, 'ПЛАН · ФАКТИЧЕСКИЕ ГРАНИ ДОСОК', x + 14, y + h - 72, 7.8, 'Bold')
            pf, _ = transform([(point[0] - radius, point[1] - radius), (point[0] + radius, point[1] + radius)], (x + 13, y + 220, 245, 240), 20)
            c.saveState(); clip = c.beginPath(); clip.rect(x + 13, y + 220, 245, 240); c.clipPath(clip, stroke=0)
            polygon(c, [pf((point[0] - cap / 2, point[1] - cap / 2)), pf((point[0] + cap / 2, point[1] - cap / 2)), pf((point[0] + cap / 2, point[1] + cap / 2)), pf((point[0] - cap / 2, point[1] + cap / 2))], None, BLUE, 1.3)
            for m in members:
                color = BLUE if m.get('beamId') != node.get('primaryBeamId') else INK
                polygon(c, [pf(p) for p in self.projected_member(m, lambda q: (q[0], q[2]))], colors.HexColor('#f0e8d9'), color, .85)
            center = pf(point); line(c, (center[0] - 8, center[1]), (center[0] + 8, center[1]), BLUE, .7); line(c, (center[0], center[1] - 8), (center[0], center[1] + 8), BLUE, .7)
            c.restoreState()
            dimension(c, pf((point[0] - cap / 2, point[1] - cap / 2)), pf((point[0] + cap / 2, point[1] - cap / 2)), -18, number(cap * 1000, 0) + ' · оголовок')
            primary = beams.get(node.get('primaryBeamId'), {}); aa, bb = xy(primary.get('a')), xy(primary.get('b')); L = max(1e-9, math.dist(aa, bb)); u = ((bb[0] - aa[0]) / L, (bb[1] - aa[1]) / L)
            project = lambda q: ((q[0] - point[0]) * u[0] + (q[2] - point[1]) * u[1], q[1])
            bottom, top = finite(self.gr.get('pileHeadY')), finite(self.gr.get('topY'))
            sf, ss = transform([(-.45, bottom - .12), (.45, top + .3)], (x + 280, y + 220, 240, 240), 20)
            text(c, 'ПРОЕКЦИЯ ВДОЛЬ ГЛАВНОЙ БАЛКИ', x + 280, y + h - 72, 7.4, 'Bold')
            c.saveState(); clip = c.beginPath(); clip.rect(x + 280, y + 220, 240, 240); c.clipPath(clip, stroke=0)
            for m in members:
                polygon(c, [sf(p) for p in self.projected_member(m, project)], colors.HexColor('#e9d6b6'), INK, .8)
            for m in self.members:
                if m.get('category') == 'floor' and segment_distance(point, xy(m.get('start')), xy(m.get('end'))) < .22:
                    polygon(c, [sf(p) for p in self.projected_member(m, project)], colors.HexColor('#e4ead9'), GREEN, .6)
            c.restoreState()
            line(c, sf((-cap / 2, bottom)), sf((cap / 2, bottom)), BLUE, 2.2)
            center = sf((0, bottom)); polygon(c, [(center[0] - 5, center[1] - 12), (center[0] + 5, center[1] - 12), (center[0], center[1] - 3)], None, BLUE, .8)
            for elevation, label in [(bottom, 'Оголовок'), (top, 'Верх пакета')]:
                ax, ay = sf((-.43, elevation)); text(c, label + ' +' + number(elevation, 3), ax, ay + 6, 6.9, color=BLUE)
            text(c, 'Плоскость оголовка показана по отметке;\nтолщина металла и анкер не назначены.', x + 282, y + 214, 6.8, color=MUTED, width=236)
            marks = list(dict.fromkeys(self.marks.get(str(m.get('id'))) for m in members if self.marks.get(str(m.get('id')))))
            text(c, 'Доски на узле: ' + ', '.join(marks) + '. Точные IDs / слои / торцы - CSV и раскладка пакетов.', x + 15, y + 165, 8, width=w - 30)
            sy = y + 127
            for bid in node.get('beamIds') or []:
                beam = beams.get(bid, {}); sec = beam.get('section') or {}
                text(c, bid + ': ' + str(beam.get('plies', sec.get('plies', '-'))) + ' × ' + str(beam.get('bMM', sec.get('b', '-'))) + ' × ' + str(beam.get('hMM', sec.get('h', '-'))) + ' мм', x + 15, sy, 8, 'Bold'); sy -= 18
            if node.get('annexIds'):
                for annex in self.annexes:
                    if annex.get('id') in node['annexIds']:
                        main = finite((self.levels[0] if self.levels else {}).get('wallBaseY')); deck = finite(annex.get('deckTopY'))
                        text(c, 'Настил дома +' + number(main, 3) + ' / веранды +' + number(deck, 3) + ' м · разница ' + number((main - deck) * 1000, 0) + ' мм.', x + 15, sy - 2, 7.5, color=GREEN, width=w - 30)
            text(c, 'СХЕМА ГЕОМЕТРИИ. Крепёж пакета, смятие, анкеры, влагозащита и фактическая передача усилий через сопряжение не подтверждены.', x + 15, y + 34, 7.4, color=ORANGE, width=w - 30)

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
        fn, scale = self.technical_base(c, (40, 145, 775, H - 265), level)
        platform = self.r.get('floorPlatform') or {}; li = int(level.get('index', 1))
        bearing_lines = [v for v in platform.get('supports') or [] if int(v.get('level', 1)) == li]
        spans = [v for v in platform.get('spans') or [] if int(v.get('level', 1)) == li]
        members = [m for m in self.members if m.get('category') == 'floor' and int(m.get('floor', m.get('level', 1))) == li]
        occupied = []
        for support in bearing_lines:
            if support.get('a') is not None and support.get('b') is not None:
                line(c, fn(xy(support['a'])), fn(xy(support['b'])), SUPPORT, 1.15, [5, 3])
        def member_color(m):
            role = str(m.get('role', ''))
            if m.get('voidId') or any(t in role.lower() for t in ('header', 'trimmer', 'void')): return ORANGE
            if role == 'wallTransferBlocking': return ORANGE
            if role == 'joist' and m.get('wallSupportWallIds'): return WALL_REINFORCEMENT
            if role in ('rimJoist', 'annexRim'): return GREEN
            if role in ('floorBlocking', 'annexBlocking', 'annexPostBearingBlock'): return BLUE
            return INK
        for m in members:
            if m.get('start') and m.get('end'):
                color = member_color(m)
                polygon(c, [fn(p) for p in self.projected_member(m, lambda q: (q[0], q[2]))], colors.HexColor('#f3eee2'), color, .6)
        marked_supports = set()
        for span in spans:
            for endpoint in ('supportStart', 'supportEnd'):
                support = span.get(endpoint) or {}
                if support.get('point') is not None:
                    point = fn(xy(support['point'])); c.setFillColor(SUPPORT); c.circle(*point, 1.6, fill=1, stroke=0)
        for support in bearing_lines:
            source = support.get('id') or support.get('sourceId')
            if source in marked_supports or support.get('a') is None or support.get('b') is None: continue
            marked_supports.add(source); a, b = xy(support['a']), xy(support['b'])
            self.technical_callout(c, self.wall_names.get(str(source), source), fn((a[0] + .2 * (b[0] - a[0]), a[1] + .2 * (b[1] - a[1]))), occupied, SUPPORT, 6.3)
        labelled_groups = set()
        for m in members:
            mark = self.marks.get(str(m.get('id'))); key = (mark, m.get('role'))
            if not mark or key in labelled_groups: continue
            labelled_groups.add(key); a, b = xy(m.get('start')), xy(m.get('end'))
            self.technical_callout(c, mark, fn(((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)), occupied, member_color(m), 6.5)
        # Chain actual main-house joist axes; annex and blocking stations are not nominal joist spacing.
        joists = [m for m in members if m.get('role') == 'joist' and not m.get('annexId')]
        if joists:
            a, b = xy(joists[0]['start']), xy(joists[0]['end']); along_y = abs(b[1] - a[1]) >= abs(b[0] - a[0])
            positions = sorted(set(round(xy(m['start'])[0 if along_y else 1], 6) for m in joists))
            lo_x, lo_y, hi_x, hi_y = bounds(self.platform_polygon(level))
            for lo, hi in zip(positions, positions[1:]):
                if (hi - lo) * scale < 18: continue
                if along_y: dimension(c, fn((lo, hi_y)), fn((hi, hi_y)), 25, number((hi - lo) * 1000, 0))
                else: dimension(c, fn((hi_x, lo)), fn((hi_x, hi)), -25, number((hi - lo) * 1000, 0))
            if spans:
                representative = next((v for v in spans if v.get('memberId') == joists[0].get('id')), spans[0])
                aa, bb = representative.get('start'), representative.get('end')
                if aa is not None and bb is not None:
                    span_a, span_b = xy(aa), xy(bb)
                    offset = -(hi_x - span_a[0]) * scale - 36 if along_y else (hi_y - span_a[1]) * scale + 49
                    dimension(c, fn(span_a), fn(span_b), offset, number(finite(representative.get('analyticalSpan')) * 1000, 0) + ' · опорные оси')
        x, y = 850, H - 144
        y = self.technical_schedule(c, members, x, y, 292, 'ДОСКИ ПЛАТФОРМЫ И НАСТИЛА', max_rows=12)
        text(c, 'МОНТАЖНЫЕ ОБОЗНАЧЕНИЯ', x, y, 9, 'Bold', GREEN); y -= 22
        for label, color, dash in [('Рядовые лаги', INK, None), ('Лаги под основаниями стен', WALL_REINFORCEMENT, None), ('Вставки под стенами', ORANGE, None), ('Обвязка по наружному контуру', GREEN, None), ('Распорки / вкладыши', BLUE, None), ('Обрамление проёмов', ORANGE, None), ('Нижележащие опорные балки', SUPPORT, [5, 3])]:
            line(c, (x, y + 3), (x + 18, y + 3), color, 1.4, dash); text(c, label, x + 25, y, 7.4, color=color); y -= 19
        model_level = next((v for v in platform.get('levels') or [] if int(v.get('index', v.get('level', 1))) == li), {})
        facts = 'Лаг дома: ' + str(len(joists)) + '; опорных линий: ' + str(len(bearing_lines)) + '. '
        if model_level.get('actualSpacing') is not None: facts += ('Базовый шаг сетки: ' if model_level.get('nonUniformSpacing') else 'Фактический шаг: ') + number(finite(model_level.get('actualSpacing')) * 1000, 1) + ' мм. '
        if spans: facts += 'Наибольший пролёт по опорным осям: ' + number(max(finite(v.get('analyticalSpan')) for v in spans), 3) + ' м.'
        y = text(c, facts, x, y - 5, 7.5, width=292) - 17
        text(c, 'Точки на балках - расчётные опорные станции. Контакт досок, передача через поперечный узел и крепёж подтверждаются отдельно. Распорка не считается вертикальной опорой лаги.', x, y, 7.4, color=ORANGE, width=292)
        self.note(c, 'Показаны физические грани досок; FG подписаны по группам и ролям. Размеры - по осям лаг; мелкие интервалы внутри пакетов вынесены в узлы. Общий габарит - по осям наружных стен. Точная привязка деталей, опор и торцов - CSV.', y=103)

    def wall_support_records(self, level):
        return [record for record in (self.r.get('floorPlatform') or {}).get('wallSupports') or [] if int(record.get('level', 1)) == int(level.get('index', 1))]

    def wall_support_members(self, record):
        ids = set(str(value) for value in record.get('boardIds') or [])
        return [member for member in getattr(self, 'members', []) if str(member.get('id')) in ids]

    def wall_support_row(self, record):
        members = self.wall_support_members(record)
        marks = collections.Counter(getattr(self, 'marks', {}).get(str(member.get('id')), '-') for member in members)
        groups = ', '.join(mark + (' ×' + str(count) if count > 1 else '') for mark, count in sorted(marks.items()))
        kind = {'exterior': 'Наружная', 'partition': 'Перегородка', 'interior': 'Внутренняя', 'bearing': 'Несущая'}.get(record.get('kind'), clean(record.get('kind')))
        orientation = {'parallel': 'Вдоль лаг', 'perpendicular': 'Поперёк лаг', 'oblique': 'Косая'}.get(record.get('orientation'), clean(record.get('orientation')))
        name = self.wall_names.get(str(record.get('wallId')), clean(record.get('wallId')))
        ids = set(str(value) for value in record.get('boardIds') or [])
        found = {str(member.get('id')) for member in members}
        if ids - found: groups += '\nНе сопоставлено IDs: ' + str(len(ids - found))
        counts = 'Лаг: ' + str(len(record.get('joistIds') or [])) + '; вставок: ' + str(len(record.get('transferBoardIds') or []))
        coverage = number(finite(record.get('coverageRatio')) * 100, 1) + '%\n' + ('Геом. полно' if record.get('geometryComplete') is True else 'Есть пробелы' if record.get('geometryComplete') is False else 'Не задано')
        return [name + '\n' + kind, orientation, counts + '\n' + groups, coverage]

    def wall_support_chunks(self, supports):
        widths = [292 * fraction for fraction in (.21, .18, .43, .18)]
        pages, current, used = [], [], 0
        for record in supports:
            row = self.wall_support_row(record)
            height = max(37, max(len(wrap(value, width - 8, 'Body', 6.7)) for value, width in zip(row, widths)) * 8.1 + 11)
            if current and used + height > 430:
                pages.append(current); current, used = [], 0
            current.append(record); used += height
        if current: pages.append(current)
        return pages

    def wall_support_nodes(self, supports):
        nodes = []
        for orientation in ('parallel', 'perpendicular'):
            candidates = [record for record in supports if record.get('orientation') == orientation and str(record.get('wallId')) in self.wall_map and record.get('boardIds')]
            candidates.sort(key=lambda record: (record.get('kind') == 'exterior', not record.get('geometryComplete'), self.wall_names.get(str(record.get('wallId')), '')))
            for record in candidates:
                wall = self.wall_map[str(record['wallId'])]; floor = self.wall_support_members(record)
                wall_members = self.wall_members(wall)
                plates = [member for member in wall_members if member.get('role') == 'plate' and member.get('platePosition') == 'bottom' and member.get('start') and member.get('end')]
                a, b = xy(wall.get('a')), xy(wall.get('b'))
                point = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
                if plates:
                    plate = max(plates, key=lambda member: finite(member.get('length')))
                    pa, pb = xy(plate['start']), xy(plate['end']); point = ((pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2)
                if orientation == 'parallel':
                    studs = [member for member in wall_members if member.get('role') in ('stud', 'kingStud', 'jackStud') and member.get('start')]
                    if studs: point = xy(min(studs, key=lambda member: math.dist(xy(member['start']), point))['start'])
                else:
                    blocks = [member for member in floor if member.get('role') == 'wallTransferBlocking' and member.get('start') and member.get('end')]
                    if not blocks: continue
                    typical = [member for member in blocks if finite(member.get('length')) >= .2] or blocks
                    block = min(typical, key=lambda member: math.dist(((xy(member['start'])[0] + xy(member['end'])[0]) / 2, (xy(member['start'])[1] + xy(member['end'])[1]) / 2), point))
                    pa, pb = xy(block['start']), xy(block['end']); point = ((pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2)
                nodes.append({'support': record, 'wall': wall, 'point': point, 'members': floor, 'wallMembers': wall_members, 'mark': 'С' + str(len(nodes) + 1)})
                break
        return nodes

    def draw_wallsupportplan(self, c, data, index):
        level, supports = data['level'], data['supports']; li = int(level.get('index', 1))
        fn, scale = self.technical_base(c, (40, 145, 775, H - 265), level)
        floor = [member for member in self.members if member.get('category') == 'floor' and int(member.get('floor', member.get('level', 1))) == li]
        for source in (self.r.get('floorPlatform') or {}).get('supports') or []:
            if int(source.get('level', 1)) == li and source.get('a') is not None and source.get('b') is not None:
                line(c, fn(xy(source['a'])), fn(xy(source['b'])), BLUE, .7, [5, 3])
        for member in floor:
            reinforced = member.get('role') == 'joist' and bool(member.get('wallSupportWallIds'))
            transfer = member.get('role') == 'wallTransferBlocking'
            color = ORANGE if transfer else WALL_REINFORCEMENT if reinforced else LINE
            fill = colors.HexColor('#f6dfc5') if transfer else colors.HexColor('#efdae8') if reinforced else None
            polygon(c, [fn(point) for point in self.projected_member(member, lambda q: (q[0], q[2]))], fill, color, .75 if reinforced or transfer else .35)
        occupied = []
        for record in supports:
            footprint = [xy(point) for point in record.get('footprint') or []]
            if footprint: polygon(c, [fn(point) for point in footprint], None, GREEN, .8)
            wall = self.wall_map.get(str(record.get('wallId')), {})
            if wall.get('a') is not None and wall.get('b') is not None:
                a, b = xy(wall['a']), xy(wall['b']); line(c, fn(a), fn(b), GREEN, .8, [3, 2])
                self.technical_callout(c, self.wall_names.get(str(record.get('wallId')), clean(record.get('wallId'))), fn((a[0] + .23 * (b[0] - a[0]), a[1] + .23 * (b[1] - a[1]))), occupied, GREEN, 6.5)
        marked = set()
        for member in floor:
            if member.get('role') != 'wallTransferBlocking' and not member.get('wallSupportWallIds'): continue
            mark = self.marks.get(str(member.get('id'))); key = (mark, member.get('role'))
            if not mark or key in marked: continue
            marked.add(key); a, b = xy(member.get('start')), xy(member.get('end'))
            self.technical_callout(c, mark, fn(((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)), occupied, ORANGE if member.get('role') == 'wallTransferBlocking' else WALL_REINFORCEMENT, 6.2)
        for node in self.wall_support_nodes(supports):
            point = fn(node['point']); marker = (point[0] + 19, point[1] + 25)
            line(c, point, marker, ORANGE, .7); c.setFillColor(colors.white); c.setStrokeColor(ORANGE); c.circle(*marker, 9, fill=1, stroke=1); text(c, node['mark'], marker[0] - 6, marker[1] - 2.5, 7, 'Bold', ORANGE)
        x, y, width = 850, H - 144, 292
        text(c, 'ОСНОВАНИЯ СТЕН · ПО ГЕОМЕТРИИ', x, y, 9, 'Bold', GREEN); y -= 24
        columns = [('Стена / тип', .21), ('Направление', .18), ('Детали / группы FG', .43), ('Покрытие', .18)]
        c.setFillColor(INK); c.rect(x, y - 25, width, 25, fill=1, stroke=0)
        left = x
        for label, fraction in columns:
            text(c, label, left + 4, y - 11, 6.4, 'Bold', colors.white, width=width * fraction - 8); left += width * fraction
        y -= 25
        for i, record in enumerate(data.get('tableSupports', supports)):
            row = self.wall_support_row(record)
            height = max(37, max(len(wrap(value, width * fraction - 8, 'Body', 6.7)) for value, (_, fraction) in zip(row, columns)) * 8.1 + 11)
            c.setFillColor(PAPER if i % 2 == 0 else colors.white); c.rect(x, y - height, width, height, fill=1, stroke=0)
            left = x
            for value, (_, fraction) in zip(row, columns):
                text(c, value, left + 4, y - 12, 6.7, width=width * fraction - 8, leading=8.1); left += width * fraction
            y -= height
        y -= 18
        for label, color, dash in [('Лаги под стенами', WALL_REINFORCEMENT, None), ('Вставки под стенами', ORANGE, None), ('Основание / ось стены', GREEN, [3, 2]), ('Нижняя опорная линия', BLUE, [5, 3])]:
            line(c, (x, y + 2), (x + 17, y + 2), color, 1.2, dash); text(c, label, x + 23, y, 7, color=color); y -= 16
        self.note(c, 'Покрытие - доля полосы основания стены над древесиной каркаса. Условный настил 35 мм остаётся между обвязкой стены и лагами: материал и несущая способность не заданы. Вставки не являются дополнительными опорами лаг; сечения и узлы требуют проверки.', y=103, color=ORANGE)

    def wall_load_rows(self, transfers):
        rows = []
        for record in transfers.get('walls') or []:
            expected, actual, balance = record.get('expected') or {}, record.get('actual') or {}, record.get('balance') or {}
            orientation = {'parallel': 'Вдоль лаг', 'perpendicular': 'Поперёк лаг'}.get(record.get('orientation'), clean(record.get('orientation')))
            state = {'routed': 'Прослежен собственный вес', 'unverified': 'Путь не подтверждён'}.get(record.get('status'), clean(record.get('status')))
            rows.append([self.wall_names.get(str(record.get('wallId')), clean(record.get('wallId'))), orientation,
                         number(record.get('woodWeight'), 4) + ' / ' + number(record.get('layerWeight'), 4),
                         number(expected.get('force'), 4) + ' / ' + number(actual.get('force'), 4), number(balance.get('force'), 6), state])
        return rows

    def wall_transfer_rows(self, transfers):
        groups = collections.defaultdict(list)
        for record in transfers.get('transferMembers') or []:
            groups[getattr(self, 'marks', {}).get(str(record.get('boardId')), clean(record.get('boardId')))].append(record)
        rows = []
        for mark, records in sorted(groups.items()):
            def greatest(field):
                values = [optional_number(record.get(field)) for record in records]
                return max((abs(value) for value in values if value is not None), default=None)
            worst = max(records, key=lambda record: optional_number(record.get('utilization')) if optional_number(record.get('utilization')) is not None else -1)
            known_deflections = [record for record in records if optional_number(record.get('deflection')) is not None and optional_number(record.get('deflectionLimit')) is not None and finite(record.get('deflectionLimit')) > 0]
            flex = max(known_deflections, key=lambda record: finite(record.get('deflection')) / finite(record.get('deflectionLimit'))) if known_deflections else {}
            walls = sorted({self.wall_names.get(str(wid), clean(wid)) for record in records for wid in record.get('wallIds') or []})
            states = [record.get('status') for record in records]
            status = 'fail' if 'fail' in states else 'unverified' if 'unverified' in states or any(state is None for state in states) else 'pass'
            rows.append([mark + ' ×' + str(len(records)), ', '.join(walls), worst.get('boardId'), number(greatest('moment'), 4), number(greatest('shear'), 4),
                         number(flex.get('deflection'), 4) + ' / ' + number(flex.get('deflectionLimit'), 4), number(greatest('utilization'), 4), STATUSES.get(status, status)])
        return rows

    def floor_joist_control(self):
        checks = (self.r.get('floorPlatform') or {}).get('joistChecks') or []
        known = [record for record in checks if record.get('numericChecksApplicable') is not False and optional_number(record.get('utilization')) is not None]
        if not known: return None
        record = max(known, key=lambda item: finite(item.get('utilization')))
        marks = list(dict.fromkeys(self.marks.get(str(mid)) for mid in record.get('partIds') or [] if self.marks.get(str(mid))))
        return {'record': record, 'marks': marks, 'numericCount': len(known), 'unknownCount': len(checks) - len(known)}

    def draw_wallloads(self, c, data, index):
        self.draw_table(c, data['table'], index)
        columns, rows, size = data['table']; bottom = H - 153 - sum(height for _, height in rows)
        control = data['control']; record = control['record']
        y = max(147, min(360, bottom - 155))
        c.setFillColor(PAPER); c.setStrokeColor(LINE); c.roundRect(42, y, W - 84, 130, 4, fill=1, stroke=1)
        text(c, 'КОНТРОЛЬНАЯ ЛАГА · НАИБОЛЬШЕЕ η ПО ОТЧЁТУ', 56, y + 110, 9.5, 'Bold', GREEN)
        label = ', '.join(control['marks']) + ' · ' + clean(record.get('id'))
        text(c, label, 56, y + 88, 8.2, 'Mono', width=W - 115)
        values = [('Сечение / L', number(record.get('b'), 0) + ' × ' + number(record.get('h'), 0) + ' мм / ' + number(record.get('span'), 3) + ' м'),
                  ('M / V', number(record.get('moment'), 4) + ' кН·м / ' + number(record.get('shear'), 4) + ' кН'),
                  ('Прогиб / предел', number(record.get('deflection'), 3) + ' / ' + number(record.get('deflectionAllowed'), 3) + ' мм'),
                  ('η / частный результат', number(record.get('utilization'), 4) + ' / ' + clean(STATUSES.get(record.get('status'), record.get('status'))))]
        for i, (name, value) in enumerate(values):
            xx = 56 + i * (W - 112) / 4
            text(c, name, xx, y + 65, 7, 'Bold', MUTED); text(c, value, xx, y + 47, 8, width=(W - 112) / 4 - 12)
        text(c, 'Численно проверено лаг: ' + str(control['numericCount']) + '; без полной численной проверки: ' + str(control['unknownCount']) + '. Нагрузки пола и прослеженный собственный вес перегородок; несущие стены и кровля исключены.', 56, y + 18, 7.4, color=ORANGE, width=W - 112)

    def wall_support_section(self, node):
        """Actual physical boards intersected by the selected vertical section plane."""
        a, b = xy(node['wall'].get('a')), xy(node['wall'].get('b'))
        length = math.dist(a, b)
        if length < 1e-9: return None
        along = ((b[0] - a[0]) / length, (b[1] - a[1]) / length)
        direction = (-along[1], along[0]) if node['support'].get('orientation') == 'parallel' else along
        normal = (-direction[1], direction[0]); point = node['point']
        def plan_local(q):
            q = xy(q); delta = (q[0] - point[0], q[1] - point[1])
            return sum(delta[i] * direction[i] for i in range(2)), sum(delta[i] * normal[i] for i in range(2))
        def project(q):
            return (q[0] - point[0]) * direction[0] + (q[2] - point[1]) * direction[1], q[1]
        records, seen = [], set()
        for member in node.get('members', []) + node.get('wallMembers', []):
            if str(member.get('id')) in seen: continue
            seen.add(str(member.get('id')))
            plan = self.projected_member(member, lambda q: plan_local((q[0], q[2])))
            if not plan or min(p[1] for p in plan) > 1e-7 or max(p[1] for p in plan) < -1e-7: continue
            polygon_ = self.projected_member(member, project)
            if polygon_: records.append({'member': member, 'polygon': polygon_})
        rec = node['support']; level = next((v for v in getattr(self, 'levels', []) if int(v.get('index', 1)) == int(rec.get('level', 1))), {})
        deck_intervals = scan_intervals([plan_local(q) for q in self.platform_polygon(level)], 0)
        for void in level.get('voids') or []:
            deck_intervals = subtract_intervals(deck_intervals, scan_intervals([plan_local(q) for q in void.get('polygon') or []], 0))
        return {'records': records, 'direction': direction, 'normal': normal, 'deckIntervals': deck_intervals,
                'framingTopY': optional_number(rec.get('framingTopY')), 'wallBaseY': optional_number(rec.get('wallBaseY')),
                'layerBasis': rec.get('layerBasis') or {}, 'deckThickness': optional_number((rec.get('layerBasis') or {}).get('thickness', rec.get('deckThickness')))}

    def draw_wallsupportnodes(self, c, nodes, index):
        for i, node in enumerate(nodes or []):
            x, y, w, h = 43 + i * 567, 155, 535, 545
            rec, wall, point = node['support'], node['wall'], node['point']
            section = self.wall_support_section(node)
            if not section: continue
            parallel = rec.get('orientation') == 'parallel'
            c.setStrokeColor(LINE); c.rect(x, y, w, h, fill=0, stroke=1)
            text(c, node['mark'] + ' · ' + ('Стена вдоль лаг' if parallel else 'Стена поперёк лаг'), x + 14, y + h - 24, 12, 'Bold', GREEN)
            text(c, self.wall_names.get(str(wall.get('id')), clean(wall.get('id'))) + ' · этаж ' + str(rec.get('level', 1)) + ' · основание ' + number(rec.get('wallDepth'), 0) + ' мм', x + 14, y + h - 44, 7.8, color=MUTED)
            text(c, 'ПЛАН · ФАКТИЧЕСКИЙ ФРАГМЕНТ', x + 14, y + h - 69, 7.5, 'Bold')
            text(c, 'СЕЧЕНИЕ ' + ('ПОПЕРЁК СТЕНЫ' if parallel else 'ВДОЛЬ СТЕНЫ'), x + 280, y + h - 69, 7.5, 'Bold')
            radius = .36 if parallel else .43
            plan_box = (x + 14, y + 220, 245, 240)
            pf, _ = transform([(point[0] - radius, point[1] - radius), (point[0] + radius, point[1] + radius)], plan_box, 19)
            ids = {str(member.get('id')) for member in node.get('members', [])}
            c.saveState(); clip = c.beginPath(); clip.rect(*plan_box); c.clipPath(clip, stroke=0)
            for member in self.members:
                if member.get('category') != 'floor' or int(member.get('floor', member.get('level', 1))) != int(rec.get('level', 1)): continue
                poly = self.projected_member(member, lambda q: (q[0], q[2]))
                if not poly: continue
                bx0, by0, bx1, by1 = bounds(poly)
                if bx1 < point[0] - radius or bx0 > point[0] + radius or by1 < point[1] - radius or by0 > point[1] + radius: continue
                highlighted = str(member.get('id')) in ids
                transfer = member.get('role') == 'wallTransferBlocking'
                color = ORANGE if highlighted and transfer else WALL_REINFORCEMENT if highlighted else LINE
                fill = colors.HexColor('#f6dfc5') if highlighted and transfer else colors.HexColor('#efdae8') if highlighted else PAPER
                polygon(c, [pf(q) for q in poly], fill, color, .9 if highlighted else .4)
            footprint = [xy(q) for q in rec.get('footprint') or []]
            if footprint: polygon(c, [pf(q) for q in footprint], None, GREEN, 1)
            a, b = xy(wall.get('a')), xy(wall.get('b')); line(c, pf(a), pf(b), GREEN, .8, [4, 3])
            direction = section['direction']
            qa = pf((point[0] - radius * direction[0], point[1] - radius * direction[1])); qb = pf((point[0] + radius * direction[0], point[1] + radius * direction[1]))
            line(c, qa, qb, INK, .8, [7, 3, 1, 3])
            c.restoreState()
            text(c, 'Штрихпунктир - выбранная плоскость сечения.', x + 15, y + 207, 6.8, color=MUTED, width=244)
            floor = [row for row in section['records'] if row['member'].get('category') == 'floor']
            top, base = section['framingTopY'], section['wallBaseY']
            if top is None or base is None:
                text(c, 'Отметки слоёв не заданы в отчёте.', x + 282, y + 330, 8, color=ORANGE, width=235)
                continue
            floor_bottom = min([p[1] for row in floor for p in row['polygon']] or [top])
            sf, _ = transform([(-radius, floor_bottom - .04), (radius, base + .29)], (x + 280, y + 220, 240, 240), 24)
            section_box = (x + 280, y + 220, 240, 240)
            c.saveState(); clip = c.beginPath(); clip.rect(*section_box); c.clipPath(clip, stroke=0)
            # The legacy deck is only a geometric layer, never an extra timber instance.
            for lo, hi in section['deckIntervals']:
                lo, hi = max(lo, -radius), min(hi, radius)
                if hi > lo:
                    polygon(c, [sf((lo, top)), sf((hi, top)), sf((hi, base)), sf((lo, base))], colors.HexColor('#dfe4e8'), BLUE, .65)
            for row in section['records']:
                member = row['member']; is_floor = member.get('category') == 'floor'
                transfer = member.get('role') == 'wallTransferBlocking'
                color = ORANGE if transfer else WALL_REINFORCEMENT if is_floor else GREEN
                fill = colors.HexColor('#f6dfc5') if transfer else colors.HexColor('#efdae8') if is_floor else colors.HexColor('#e4ead8')
                polygon(c, [sf(q) for q in row['polygon']], fill, color, .85)
            line(c, sf((-radius, top)), sf((radius, top)), BLUE, .5, [3, 2])
            line(c, sf((-radius, base)), sf((radius, base)), GREEN, .5, [3, 2])
            c.restoreState()
            dx = .25 if parallel else radius - .035
            dimension(c, sf((dx, floor_bottom)), sf((dx, top)), -9, number((top - floor_bottom) * 1000, 0) + ' мм')
            # The 35 mm gap is called out separately to avoid an illegible dimension chain.
            text(c, 'Верх лаг +' + number(top, 3), x + 282, y + 208, 7, color=WALL_REINFORCEMENT)
            text(c, 'Низ стены +' + number(base, 3), x + 282, y + 194, 7, color=GREEN)
            local_marks = collections.Counter(self.marks.get(str(row['member'].get('id')), '-') for row in floor if max(p[0] for p in row['polygon']) >= -radius and min(p[0] for p in row['polygon']) <= radius)
            marks = ', '.join(mark + (' ×' + str(count) if count > 1 else '') for mark, count in sorted(local_marks.items()))
            text(c, 'На сечении: ' + marks + '. Точная привязка физических IDs - CSV.', x + 15, y + 174, 7.4, width=w - 30)
            if parallel:
                # Read the section/count from actual boards intersecting the section, not a prescribed package.
                near = [row['member'] for row in floor if max(p[0] for p in row['polygon']) >= -finite(rec.get('wallDepth')) / 2000 and min(p[0] for p in row['polygon']) <= finite(rec.get('wallDepth')) / 2000]
                sizes = collections.Counter((finite(m.get('b')), finite(m.get('h'))) for m in near)
                label = '; '.join(str(count) + ' × ' + number(b, 0) + ' × ' + number(hh, 0) + ' мм' for (b, hh), count in sorted(sizes.items()))
                text(c, 'Под стеной: ' + (label or 'нет сопоставленных досок') + '. Каждая лага - отдельная доска; совместная работа пакета не подтверждена.', x + 15, y + 143, 8, 'Bold', width=w - 30)
            else:
                text(c, 'Полноразмерные вставки передают нагрузку стены на соседние лаги. Торцевые соединения и эксцентриситет передачи требуют проверки; вставка не укорачивает пролёт лаги.', x + 15, y + 143, 8, 'Bold', width=w - 30)
            gap = (base - top) * 1000
            text(c, 'Условный настил ' + number(gap, 0) + ' мм: материал/несущая способность не заданы. Собственная масса учтена в floorDead; дополнительная масса не добавлена.', x + 15, y + 88, 7.5, color=ORANGE, width=w - 30)
            text(c, 'ГЕОМЕТРИЯ, НЕ ПОДТВЕРЖДЁННЫЙ УЗЕЛ. Крепёж, смятие, распределение нагрузки через настил и передача несущих стен / кровли здесь не проверены.', x + 15, y + 41, 7.4, color=ORANGE, width=w - 30)

    def wall_members(self, wall):
        wid = str(wall.get('id'))
        return [m for m in self.members if str(m.get('wallId')) == wid or wid in [str(x) for x in m.get('wallIds', [])]]

    def partition_head_details(self):
        """Resolve explicit head metadata and canonical timber; no guessed bearing."""
        model = self.r.get('partitionHeads') or {}
        if not isinstance(model, dict): return []
        members = {str(member.get('id')): member for member in self.members}
        details = []
        for record in model.get('items') or []:
            wall = self.wall_map.get(str(record.get('wallId')))
            if not wall: continue
            wall_members = self.wall_members(wall)
            targets = [members[str(mid)] for mid in record.get('targetMemberIds') or [] if str(mid) in members]
            target, top = optional_number(record.get('targetY')), optional_number(record.get('topY'))
            vertices = [p for member in wall_members for p in self.projected_member(member, lambda q: (q[0], q[1]))]
            ceiling_zone_ids = {member.get('zoneId') for member in targets if member.get('zoneId') is not None}
            zones = [zone for zone in (getattr(self, 'roof', {}) or {}).get('zones') or [] if zone.get('id') in ceiling_zone_ids]
            # A zone-level reference is only accepted when the engine provides it.
            if not zones and record.get('zoneId') is not None:
                zones = [zone for zone in (getattr(self, 'roof', {}) or {}).get('zones') or [] if zone.get('id') == record.get('zoneId')]
            ceiling_members = [member for member in self.members if member.get('zoneId') in {zone.get('id') for zone in zones} and str(member.get('role', '')).startswith('ceiling')]
            details.append({'record': record, 'wall': wall, 'members': wall_members, 'targets': targets, 'zones': zones, 'ceilingMembers': ceiling_members,
                            'gap': target - top if target is not None and top is not None else None,
                            'physicalTopY': max((p[1] for p in vertices), default=None)})
        return details

    def partition_head_row(self, detail):
        record = detail['record']; target_marks = list(dict.fromkeys(self.marks.get(str(member.get('id'))) for member in detail['targets'] if self.marks.get(str(member.get('id')))))
        def elevation(value): return ('+' if finite(value) >= 0 else '') + number(value, 3) if optional_number(value) is not None else '-'
        return [self.wall_names.get(str(record.get('wallId')), clean(record.get('wallId'))), number(record.get('effectiveHeight'), 3),
                elevation(record.get('topY')), elevation(record.get('targetY')),
                number(detail.get('gap') * 1000 if detail.get('gap') is not None else None, 1), ', '.join(target_marks) or 'Не сопоставлены']

    def draw_partitionheads(self, c, details, index):
        if not details: return
        detail = next((entry for entry in details if entry['members'] and entry['targets']), details[0])
        wall, rec = detail['wall'], detail['record']; a, b = xy(wall.get('a')), xy(wall.get('b')); length = math.dist(a, b)
        if length < 1e-9: return
        ux, uz = (b[0] - a[0]) / length, (b[1] - a[1]) / length
        def local(q): return (q[0] - a[0]) * ux + (q[2] - a[1]) * uz, q[1]
        wall_shapes = [(member, self.projected_member(member, local)) for member in detail['members'] if member.get('start') and member.get('end')]
        target_shapes = [(member, self.projected_member(member, local)) for member in detail['targets'] if member.get('start') and member.get('end')]
        ceiling_shapes = [(member, self.projected_member(member, local)) for member in detail['ceilingMembers'] if member.get('start') and member.get('end')]
        pts = [p for _, poly in wall_shapes for p in poly]
        if not pts:
            text(c, 'Физические доски выбранной перегородки не переданы.', 48, H - 160, 9, color=ORANGE); return
        base = min(p[1] for p in pts); actual_top = max(p[1] for p in pts); target = optional_number(rec.get('targetY')); top = optional_number(rec.get('topY'))
        high = max(actual_top, target if target is not None else actual_top)
        x, y, w, h = 43, 345, 670, H - 488
        c.setStrokeColor(LINE); c.rect(x, y, w, h, fill=0, stroke=1)
        text(c, 'СХЕМА ОТМЕТОК · ' + self.wall_names.get(str(wall.get('id')), 'Перегородка'), x + 13, y + h - 21, 10, 'Bold', GREEN)
        text(c, 'Проекция фактических досок на ось A → B. Элементы в разных поперечных плоскостях могут совмещаться.', x + 13, y + h - 39, 6.8, color=MUTED, width=w - 26)
        fn, scale = transform([(0, base), (length, high + .16)], (x + 32, y + 42, w - 213, h - 92), 16)
        zones = detail['zones']; zone = zones[0] if zones else {}
        datum, insulation = optional_number(zone.get('ceilingDatumY')), optional_number(zone.get('ceilingInsulationTopY'))
        if datum is not None and insulation is not None and insulation >= datum:
            polygon(c, [fn((0, datum)), fn((length, datum)), fn((length, insulation)), fn((0, insulation))], LIME, GREEN, .45)
            text(c, 'Холодный чердак', x + w - 158, fn((0, insulation))[1] + 6, 8, 'Bold', BLUE, width=147)
            text(c, 'Тёплое помещение', x + w - 158, fn((0, datum))[1] - 23, 8, 'Bold', GREEN, width=147)
        c.saveState(); clip = c.beginPath(); clip.rect(x + 32, y + 42, w - 195, h - 92); c.clipPath(clip, stroke=0)
        for member, poly in target_shapes:
            polygon(c, [fn(p) for p in poly], colors.HexColor('#eee0c6'), WOOD_DARK, .7)
        seen = set()
        for member, poly in ceiling_shapes:
            key = tuple(sorted((round(p[0], 5), round(p[1], 5)) for p in poly))
            if key in seen: continue
            seen.add(key); polygon(c, [fn(p) for p in poly], colors.HexColor('#e2eaf0'), BLUE, .55)
        for member, poly in wall_shapes:
            polygon(c, [fn(p) for p in poly], colors.HexColor('#e9d9bd'), GREEN, .65)
        c.restoreState()
        for elevation, label, color in [(target, 'Низ затяжки / цель', WOOD_DARK), (top, 'Верх перегородки', GREEN), (datum, 'Верх брусков потолка', BLUE), (insulation, 'Верх утепления', GREEN)]:
            if elevation is None: continue
            yy = fn((0, elevation))[1]; line(c, fn((0, elevation)), fn((length, elevation)), color, .5, [3, 2])
        dimension(c, fn((0, base)), fn((0, actual_top)), 20, number((actual_top - base) * 1000, 0) + ' · каркас')
        text(c, 'Низ перегородки +' + number(base, 3), x + 14, y + 17, 7.3, color=GREEN)
        # A separate close-up makes the adopted gap legible without changing geometry.
        nx, ny, nw, nh = 43, 144, 670, 181
        c.setStrokeColor(LINE); c.rect(nx, ny, nw, nh, fill=0, stroke=1)
        text(c, 'ФРАГМЕНТ ВЕРХА · ГЕОМЕТРИЯ ПРИМЫКАНИЯ', nx + 13, ny + nh - 21, 9, 'Bold', GREEN)
        if target is not None and top is not None:
            studs = [member for member in detail['members'] if member.get('role') in ('stud', 'kingStud', 'jackStud') and member.get('start')]
            station = local(xyz(min(studs, key=lambda member: abs(local(xyz(member['start']))[0] - length / 2))['start']))[0] if studs else length / 2
            nf, _ = transform([(station - .28, top - .1), (station + .28, target + .08)], (nx + 18, ny + 20, 280, 127), 10)
            c.saveState(); clip = c.beginPath(); clip.rect(nx + 18, ny + 20, 280, 127); c.clipPath(clip, stroke=0)
            for member, poly in target_shapes:
                polygon(c, [nf(p) for p in poly], colors.HexColor('#eee0c6'), WOOD_DARK, .8)
            for member, poly in wall_shapes:
                polygon(c, [nf(p) for p in poly], colors.HexColor('#e9d9bd'), GREEN, .8)
            line(c, nf((station - .28, target)), nf((station + .28, target)), WOOD_DARK, .5, [3, 2]); line(c, nf((station - .28, top)), nf((station + .28, top)), GREEN, .5, [3, 2]); c.restoreState()
            dimension(c, nf((station + .2, top)), nf((station + .2, target)), -9, number((target - top) * 1000, 1) + ' мм')
            text(c, 'Зазор ' + number((target - top) * 1000, 1) + ' мм принят в модели.', nx + 320, ny + 119, 9, 'Bold', ORANGE, width=334)
        else:
            text(c, 'Целевая отметка / верх не переданы.', nx + 20, ny + 82, 8, color=ORANGE)
        text(c, 'Это не нормативный размер и не подтверждение допустимого перемещения. Крепёж не показан: тип скользящих клипс, ход, боковая жёсткость и фиксация требуют проектирования.', nx + 320, ny + 95, 7.5, color=ORANGE, width=334)
        bearing = rec.get('verticalBearing')
        bearing_note = 'Перегородка не является вертикальной опорой кровли.' if bearing is False else 'Передача вертикальной нагрузки этим примыканием не подтверждена.'
        text(c, bearing_note, nx + 320, ny + 35, 7.5, 'Bold', GREEN, width=334)
        # Right-hand schedule is based on the item values, not nominal project wall height.
        tx, ty, tw = 747, H - 145, W - 790
        columns = [('Стена', .16), ('Hэфф., м', .16), ('Верх, м', .17), ('Цель, м', .17), ('Зазор, мм', .14), ('Затяжка FG', .2)]
        text(c, 'ПЕРЕГОРОДКИ · ПРИНЯТЫЕ ОТМЕТКИ', tx, ty, 9, 'Bold', GREEN); ty -= 17
        c.setFillColor(INK); c.rect(tx, ty - 29, tw, 29, fill=1, stroke=0)
        xx = tx
        for label, fraction in columns:
            text(c, label, xx + 4, ty - 11, 6.8, 'Bold', colors.white, width=tw * fraction - 8); xx += tw * fraction
        ty -= 29
        for i, item in enumerate(details):
            row = self.partition_head_row(item); rh = max(33, max(len(wrap(value, tw * fraction - 8, 'Body', 7)) for value, (_, fraction) in zip(row, columns)) * 8.5 + 10)
            c.setFillColor(PAPER if i % 2 == 0 else colors.white); c.rect(tx, ty - rh, tw, rh, fill=1, stroke=0); xx = tx
            for value, (_, fraction) in zip(row, columns):
                text(c, value, xx + 4, ty - 12, 7, width=tw * fraction - 8, leading=8.5); xx += tw * fraction
            ty -= rh
        ty -= 23
        for label, elevation, color in [('Низ целевой затяжки', target, WOOD_DARK), ('Верх каркаса перегородки', top, GREEN), ('Верх брусков потолка', datum, BLUE), ('Верх утепления потолка', insulation, GREEN)]:
            text(c, label + (': +' + number(elevation, 3) + ' м' if elevation is not None else ': не передано'), tx, ty, 8.2, 'Bold', color, width=tw); ty -= 22
        finished = zone.get('ceilingFinishBottomY', zone.get('finishedCeilingY'))
        if optional_number(finished) is not None:
            text(c, 'Низ отделки потолка: +' + number(finished, 4) + ' м', tx, ty, 8.2, 'Bold', BLUE, width=tw); ty -= 25
        text(c, 'Высота перегородки и отметка потолка - разные параметры. Поднятый каркас выходит в холодный чердак; потолочная плоскость и слой утепления берутся из отчёта кровли.', tx, ty - 4, 8, width=tw); ty -= 64
        text(c, 'Потолочные доски на рисунке - реальные ceilingBatten / ceilingHanger / ceilingLedger из timber. Утеплённый диапазон обозначен цветом; непрерывность пароизоляции, герметизация и тепловой мост не подтверждены.', tx, ty, 7.5, color=ORANGE, width=tw)
        self.note(c, 'Марки затяжек сопоставлены по canonical targetMemberIds. Изображение показывает отметки и проекции, не рассчитанную конструкцию скользящего узла. Фактические доски и раскрой - FG / FP / CSV.', y=107, color=MUTED)

    def wall_frame_data(self, wall):
        """Wall elevation geometry excludes floor references and uses physical faces."""
        members = [member for member in self.wall_members(wall) if member.get('category') == 'walls']
        a, b = xy(wall.get('a')), xy(wall.get('b')); length = math.dist(a, b)
        ux, uz = (b[0] - a[0]) / max(length, 1e-9), (b[1] - a[1]) / max(length, 1e-9)
        def local(point):
            xx, yy, zz = xyz(point)
            return (xx - a[0]) * ux + (zz - a[1]) * uz, yy
        profiles = [(member, self.projected_member(member, local)) for member in members if member.get('start') and member.get('end')]
        profiles = [(member, shape) for member, shape in profiles if shape]
        points = [point for _, shape in profiles for point in shape]
        return {'members': members, 'profiles': profiles, 'points': points, 'bounds': bounds(points) if points else None, 'axisLength': length, 'local': local}

    def draw_wallframes(self, c, walls, index):
        for i, wall in enumerate(walls or []):
            x, y, w, h = 43, H - 420 - i * 325, W - 86, 305
            data = self.wall_frame_data(wall); members, profiles, local = data['members'], data['profiles'], data['local']; length = data['axisLength']
            c.setStrokeColor(LINE); c.rect(x, y, w, h, fill=0, stroke=1)
            title = f'{self.wall_names.get(str(wall.get("id")), "Стена")} · этаж {wall.get("level", 1)} · ось {number(length * 1000, 0)} мм'
            text(c, title, x + 13, y + h - 20, 11, 'Bold')
            text(c, wall.get('id'), x + w - 275, y + h - 20, 7, 'Mono', MUTED)
            if data['bounds'] is None:
                text(c, 'Физические доски категории walls отсутствуют в отчёте.', x + 18, y + h - 55, 8, color=ORANGE); continue
            pts = data['points']; left, low, right, high = data['bounds']
            level = next((v for v in self.levels if int(v.get('index', 1)) == int(wall.get('level', 1))), {})
            base = finite(level.get('wallBaseY'), low)
            fn, scale = transform(pts, (x + 35, y + 32, w - 310, h - 62), 20)
            for op in self.p.get('openings') or []:
                if str(op.get('wallId')) != str(wall.get('id')):
                    continue
                s = finite(op.get('offset')); sill = finite(op.get('sill')); oh = finite(op.get('height')); ow = finite(op.get('width'))
                polygon(c, [fn((s, base + sill)), fn((s + ow, base + sill)), fn((s + ow, base + sill + oh)), fn((s, base + sill + oh))], colors.HexColor('#edf5f7'), BLUE, .6)
                aa, bb = fn((s, base + sill + oh / 2)), fn((s + ow, base + sill + oh / 2))
                text(c, f'{number(ow * 1000, 0)} × {number(oh * 1000, 0)}', (aa[0] + bb[0]) / 2 - 27, aa[1], 6.5, color=BLUE)
            for j, (m, shape) in enumerate(profiles):
                aa, bb = fn(local(m['start'])), fn(local(m['end']))
                is_brace = m.get('role') == 'letInBrace'
                polygon(c, [fn(point) for point in shape], LIME if is_brace else WOOD, GREEN if is_brace else WOOD_DARK, .55)
                # Labels are spread over two bands; full detail IDs remain in registry.
                if j % max(1, math.ceil(len(members) / 20)) == 0:
                    mx, my = (aa[0] + bb[0]) / 2, (aa[1] + bb[1]) / 2
                    text(c, self.marks.get(str(m.get('id')), ''), mx + 3, my + (5 if j % 2 else -8), 5.8, 'Mono', GREEN if is_brace else INK)
                for notch in m.get('notches') or []:
                    poly = [local(p) for p in notch.get('polygon', [])]
                    if len(poly) >= 3:
                        polygon(c, [fn(p) for p in poly], None, RED, .6)
            dimension(c, fn((left, low)), fn((right, low)), -17, number((right - left) * 1000, 0))
            dimension(c, fn((left, low)), fn((left, high)), 20, number((high - low) * 1000, 0))
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
            text(c, f'Всего {len(members)} физических деталей.\nРазмеры / отметки - по граням древесины.\nКрасным - выборки; точные ID - в CSV/JSON.', sx, y + 49, 7, color=MUTED, width=250)

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
            y = text(c, 'В' + str(j + 1) + ' · ' + clean(annex.get('name', annex.get('id'))) + ('\nКровля пристройки; основание и опоры - на общем монтажном плане.' if (annex.get('foundation') or {}).get('shared') else '\nКровля самостоятельной пристройки; подробный план и опоры - на её листе.'), x, y, 8, 'Bold', BLUE, width=240) - 16
        self.note(c, 'Пунктир - оси опорного контура; зелёный - покрытие дома; голубой - кровля веранды. Стрелки - сток; оранжевый - ендовы; красный - примыкания. Размерные линии свесов: от опорных осей, по горизонтали.', y=105)

    def roof_frame_force_rows(self, zone):
        frame = zone.get('frameAnalysis') or {}
        labels = {'topChord': 'Стропило / верхний пояс', 'bottomChord': 'Нижняя затяжка', 'kneePost': 'Внутренний подкос', 'collarTie': 'Верхний ригель', 'ceilingHanger': 'Подвес потолка'}
        rows = []
        for member in frame.get('members') or []:
            if not isinstance(member, dict): continue
            actual = [m for m in getattr(self, 'members', []) if m.get('zoneId') == zone.get('id') and m.get('frameMemberId') == member.get('id')]
            marks = list(dict.fromkeys(getattr(self, 'marks', {}).get(str(m.get('id'))) for m in actual if getattr(self, 'marks', {}).get(str(m.get('id')))))
            title = clean(member.get('id')) + '\n' + labels.get(member.get('role'), ROLE.get(member.get('role'), clean(member.get('role'))))
            if marks: title += '\n' + ', '.join(marks)
            if member.get('localOwnWeightBending') is True: title += '\n+ локальный изгиб от своего веса'
            rows.append([title, clean(member.get('b')) + ' × ' + clean(member.get('h')), number(member.get('length'), 3), number(member.get('maxAxial'), 3), number(member.get('maxShear'), 3), number(member.get('maxMoment'), 4), number(member.get('deflectionMM'), 3) + ' / ' + number(member.get('limitMM'), 3), number(member.get('utilization'), 4), STATUSES.get(member.get('status'), clean(member.get('status')))])
        return rows

    def roof_frame_model_rows(self, zone):
        frame = zone.get('frameAnalysis') or {}; design = frame.get('design') or {}; service = frame.get('service') or {}
        rows = [['Зона / статус расчёта', clean(zone.get('id')) + ' / ' + clean(frame.get('status'))], ['Узлы / элементы', str(len(frame.get('nodes') or [])) + ' / ' + str(len(frame.get('elements') or []))]]
        settings = frame.get('input') or {}
        for title, keys in [('Пролёт / шаг / предел прогиба', [('span', 'L, м'), ('spacing', 'Шаг рам, м'), ('ceilingSpacing', 'Грузовая ширина потолка, м'), ('deflectionRatio', 'Знаменатель L /')]), ('Постоянные и снег, кН/м²', [('roofDead', 'Кровля'), ('ceilingDead', 'Потолок'), ('snow', 'Снег'), ('mu', 'μ')]), ('Коэффициенты нагрузки', [('gammaG', 'γG'), ('gammaQ', 'γQ')])]:
            values = [label + ': ' + number(settings.get(key), 4) for key, label in keys if optional_number(settings.get(key)) is not None]
            if values: rows.append([title, '; '.join(values)])
        results = {r.get('id'): r for r in design.get('elementResults') or [] if isinstance(r, dict)}
        stiffness = collections.OrderedDict()
        for element in frame.get('elements') or []:
            result = results.get(element.get('id'), {})
            key = (element.get('b'), element.get('h'), element.get('E'), result.get('EA'), result.get('EI'), element.get('releaseA', result.get('releaseA')), element.get('releaseB', result.get('releaseB')), element.get('kind', result.get('kind')))
            stiffness.setdefault(key, []).append(clean(element.get('id')))
        for (b, h, modulus, ea, ei, release_a, release_b, kind), ids in stiffness.items():
            release = lambda value: 'освобождён' if value is True else 'не освобождён' if value is False else 'не задано'
            rows.append(['Участки ' + ', '.join(ids), 'b × h = ' + clean(b) + ' × ' + clean(h) + ' мм; E = ' + number(modulus, 1) + ' МПа; EA = ' + number(ea, 3) + ' кН; EI = ' + number(ei, 4) + ' кН·м².\nПоворот A: ' + release(release_a) + '; B: ' + release(release_b) + '; тип элемента: ' + clean(kind) + '.' + (' Осевой элемент: изгибная жёсткость сечения в работе элемента не участвует.' if kind == 'truss' else '')])
        for support in frame.get('supports') or []:
            restraint = lambda value: 'закреплён' if value is True else 'свободен' if value is False else 'не задано'
            rows.append(['Опора ' + clean(support.get('node')), 'ux: ' + restraint(support.get('ux')) + '; uy: ' + restraint(support.get('uy')) + '; rz: ' + restraint(support.get('rz')) + '.'])
        for name, case in [('Расчётная нагрузка', design), ('Эксплуатационная нагрузка', service)]:
            facts = []
            if case.get('stable') is not None:
                facts.append('Матрица решена.' if case['stable'] is True else 'Расчёт неустойчив / не решён.')
            for reaction in case.get('reactions') or []:
                if isinstance(reaction, dict) and any(abs(finite(reaction.get(k))) > 1e-10 for k in ('fx', 'fy', 'mz')):
                    facts.append(clean(reaction.get('node')) + ': Rx = ' + number(reaction.get('fx'), 4) + ' кН; Ry = ' + number(reaction.get('fy'), 4) + ' кН; Mz = ' + number(reaction.get('mz'), 4) + ' кНм.')
            if isinstance(case.get('equilibrium'), dict):
                equilibrium = case['equilibrium']
                facts.append('Невязка: ΣFx = ' + number(equilibrium.get('fx'), 7) + ' кН; ΣFy = ' + number(equilibrium.get('fy'), 7) + ' кН; ΣM = ' + number(equilibrium.get('moment'), 7) + ' кНм.')
            if facts: rows.append([name + ' · реакции и равновесие', '\n'.join(facts)])
        for member in frame.get('members') or []:
            if member.get('localOwnWeightBending') is True:
                rows.append(['Локальный скрининг ' + clean(member.get('id')), 'N получено из осевого элемента общей рамы. В M/V и прогиб добавлена отдельная балочная проверка на собственный вес по флагу localOwnWeightBending. Изгибная жёсткость ригеля в общей раме не учитывается.'])
        assumptions = list(dict.fromkeys(clean(v) for v in frame.get('assumptions') or []))
        for i, assumption in enumerate(assumptions, 1):
            rows.append(['Допущение схемы ' + str(i), assumption])
        solver_notes = list(dict.fromkeys(clean(v) for source in (design, service) for v in source.get('assumptions') or [] if clean(v) not in assumptions))
        translations = {
            'Linear small-displacement': 'Линейные элементы Эйлера–Бернулли при малых перемещениях. Сдвиговые деформации, P–Δ, потеря устойчивости, податливость соединений и работа из плоскости не моделируются.',
            'Unreleased beam nodes': 'Узлы без освобождения поворота разделяют один поворот внутри непрерывной доски; это не доказывает жёсткость гвоздевого соединения.',
            'Element end-moment releases': 'Концевые освобождения моментов учтены статической конденсацией с согласованными распределёнными нагрузками; локальные повороты и усилия восстановлены.',
            'maxDeflection is': 'maxDeflection - абсолютное вертикальное перемещение в метрах; maxTransverseDeflection - поперечное перемещение относительно хорды концов элемента.'}
        if solver_notes:
            readable = [next((translation for prefix, translation in translations.items() if note.startswith(prefix)), note) for note in solver_notes]
            rows.append(['Допущения численного решателя', '\n'.join('• ' + note for note in readable)])
        for i, error in enumerate([*(frame.get('errors') or []), *(design.get('errors') or []), *(service.get('errors') or [])], 1):
            rows.append(['Ошибка расчёта ' + str(i), clean(error)])
        rows.append(['Граница подтверждения', '2D-модель по номинальным b × h. Податливость узлов, ослабление жёсткости запилами, крепёж, смятие и внеплоскостная устойчивость не подтверждены.'])
        return rows

    def collar_lap_detail(self, zone):
        candidates = []
        for row in zone.get('frameRows') or []:
            contacts = [connection for connection in row.get('lapConnections') or [] if isinstance(connection, dict) and len(connection.get('worldContactPolygon') or []) >= 3]
            if contacts:
                candidates.append((max(abs(finite(c.get('demandKN'))) for c in contacts), row, contacts))
        if not candidates:
            return None
        _, row, contacts = max(candidates, key=lambda item: item[0])
        member_ids = list(dict.fromkeys(str(member_id) for contact in contacts for member_id in contact.get('memberWorldIds') or []))
        by_id = {str(member.get('id')): member for member in getattr(self, 'members', [])}
        members = [by_id[member_id] for member_id in member_ids if member_id in by_id]
        return {'zone': zone, 'row': row, 'contacts': contacts, 'members': members, 'memberIds': member_ids}

    def collar_lap_snow_envelope(self, zone):
        candidates = []
        for case in (getattr(self, 'r', {}).get('snowAssessment') or {}).get('cases') or []:
            for frame in case.get('frames') or []:
                if frame.get('zoneId') != zone.get('id'): continue
                for connection in frame.get('connections') or []:
                    value = optional_number(connection.get('axisOffsetMomentScaleKNm'))
                    if value is not None:
                        candidates.append((abs(value), case, connection))
        if not candidates: return None
        value, case, connection = max(candidates, key=lambda item: item[0])
        cases = list(dict.fromkeys(clean(item[1].get('id', item[1].get('name'))) for item in candidates if abs(item[0] - value) < 1e-9))
        return {'connection': connection, 'caseIds': cases}

    def draw_roofsections(self, c, zones, index):
        for j, zone in enumerate(zones or []):
            expanded = len(zones or []) == 1 and bool(zone.get('frameAnalysis'))
            x, y, w, h = (43, 124, W - 86, H - 246) if expanded else (43, H - 425 - j * 325, W - 86, 305)
            c.setStrokeColor(LINE); c.rect(x, y, w, h, fill=0, stroke=1)
            framing_name = 'Стропила с затяжкой · 2D-рама' if zone.get('effectiveFraming') == 'tiedRafters' else zone.get('effectiveFraming', '-')
            text(c, f'{zone.get("name", zone.get("id"))} · {zone.get("shape")} · {framing_name}', x + 14, y + h - 22, 11, 'Bold')
            angle = math.radians(finite(zone.get('ridgeAngle')))
            vx, vz = -math.sin(angle), math.cos(angle)
            def local(p):
                xx, yy, zz = xyz(p)
                return xx * vx + zz * vz, yy
            members = [m for m in self.members if m.get('zoneId') == zone.get('id')]
            profiles = [(m, self.projected_member(m, local)) for m in members if m.get('start') and m.get('end')]
            pts = [point for _, shape in profiles for point in shape]
            if not pts:
                text(c, 'Физические элементы зоны отсутствуют в отчёте.', x + 20, y + 180, 10, color=ORANGE)
                continue
            drawing_box = (x + 15, y + 238, w * .61, h - 300) if expanded else (x + 15, y + 33, w * .61, h - 78)
            fn, scale = transform(pts, drawing_box, 25)
            seen = set()
            for m, shape in profiles:
                key = tuple(sorted((round(p[0], 5), round(p[1], 5)) for p in shape))
                if key in seen:
                    continue
                seen.add(key)
                role = str(m.get('role', '')).lower()
                color = BLUE if 'collar' in role or 'ledger' in role else ORANGE if 'knee' in role else GREEN if 'tie' in role or 'bottomchord' in role else MUTED if 'hanger' in role else WOOD_DARK
                polygon(c, [fn(p) for p in shape], colors.HexColor('#eee0c6'), color, .65)
            mn, lo, mx, hi = bounds(pts)
            dimension(c, fn((mn, lo)), fn((mx, lo)), -15, number((mx - mn) * 1000, 0))
            sx, sy = x + w * .66, y + h - 48
            text(c, 'Задано / принято: ' + clean(zone.get('requestedSection', zone.get('chordSection'))) + ' / ' + clean(zone.get('selectedSection', zone.get('effectiveSection'))), sx, sy, 8.5, 'Bold', width=w * .31)
            sy -= 28
            sy = text(c, zone.get('framingReason', ''), sx, sy, 8, width=w * .31) - 12
            ra = zone.get('rafterAnalysis') or {}; frame = zone.get('frameAnalysis') or {}
            if frame:
                summaries = []
                for key, label in [('bottomChordBottomY', 'Низ затяжки'), ('ceilingDatumY', 'Базовая отметка потолка'), ('ceilingInsulationTopY', 'Верх утепления потолка')]:
                    if optional_number(zone.get(key)) is not None:
                        summaries.append(label + ': +' + number(zone.get(key), 3) + ' м')
                finished = zone.get('ceilingFinishBottomY', zone.get('finishedCeilingY'))
                if optional_number(finished) is not None:
                    summaries.append('Низ отделки потолка: +' + number(finished, 4) + ' м')
                values = [finite(member.get('utilization')) for member in frame.get('members') or [] if optional_number(member.get('utilization')) is not None]
                if values: summaries.append('Макс. использование η: ' + number(max(values), 4))
                summaries.append('N / V / M и прогибы: следующие расчётные листы.')
                for label in summaries:
                    sy = text(c, label, sx, sy, 7.5, width=w * .31) - 7
                if expanded:
                    for role in ('topChord', 'bottomChord', 'collarTie', 'kneePost', 'ceilingHanger', 'ceilingLedger', 'ceilingBatten'):
                        actual = [m for m in members if m.get('role') == role]
                        if not actual: continue
                        sections = list(dict.fromkeys(clean(m.get('b')) + ' × ' + clean(m.get('h')) for m in actual))
                        sy = text(c, ROLE.get(role, role) + ': ' + '; '.join(sections) + ' мм · ' + str(len(actual)) + ' шт. в зоне', sx, sy - 3, 7.5, width=w * .31) - 8
                    self.draw_roof_seats(c, zone, profiles, local, (x + 15, y + 25, w * .61, 180))
            elif ra:
                for label, value in [('Пролёт / длина ската', f'{number(ra.get("horizontalSpan"), 3)} / {number(ra.get("slopeLength"), 3)} м'), ('Напряжение изгиба', number(ra.get('stress'), 3) + ' МПа'), ('Вертикальный прогиб', number(ra.get('verticalDeflection'), 3) + ' / ' + number(ra.get('deflectionAllowed'), 3) + ' мм'), ('Использование η', number(ra.get('utilization'), 4))]:
                    sy = text(c, label + ': ' + value, sx, sy, 8, width=w * .31) - 7
            else:
                analysis = zone.get('analysis') or {}
                sy = text(c, 'Типовая ферма: ' + clean(zone.get('trussType')) + '\nСтатус: ' + clean(analysis.get('status')) + '\nПрименимость: ' + ('типовая схема применима' if zone.get('analysisApplicable') else 'к обрезанным/частичным элементам не подтверждена'), sx, sy, 8, width=w * .31)
            side_lap = any(member.get('role') == 'collarTie' and (member.get('collarConnection') == 'faceLap' or abs(finite(member.get('outOfPlaneOffset'))) > 1e-8) for member in members)
            note = 'Ригель находится в боковой плоскости. Его перекрытие со стропилами на фронтальной проекции не означает объёмного пересечения древесины. Поперечная толщина и контакт - на отдельном листе узла; крепёж не рассчитан.' if side_lap else 'Проекция физических досок; совпадающие тела рам показаны один раз. Чистовые профили и скосы - по данным модели. Опорные узлы не рассчитаны.'
            text(c, note, sx, y + 55 if side_lap else y + 40, 7.4, color=ORANGE, width=w * .31)

    def draw_collarlap(self, c, detail, index):
        zone, row, contacts, members = detail['zone'], detail['row'], detail['contacts'], detail['members']
        angle = math.radians(finite(zone.get('ridgeAngle'))); cosine, sine = math.cos(angle), math.sin(angle)
        front = lambda point: (-xyz(point)[0] * sine + xyz(point)[2] * cosine, xyz(point)[1])
        plan = lambda point: (xyz(point)[0] * cosine + xyz(point)[2] * sine - finite(row.get('u')), -xyz(point)[0] * sine + xyz(point)[2] * cosine)
        collar = next((member for member in members if member.get('role') == 'collarTie'), None)
        x, y = 43, H - 139
        text(c, 'ФРОНТАЛЬНАЯ ПРОЕКЦИЯ · ДВЕ БОКОВЫЕ ПЛОСКОСТИ', x, y, 9, 'Bold', GREEN)
        text(c, 'Рама ' + str(int(finite(row.get('row'))) + 1) + ' · U=' + number(row.get('u'), 4) + ' м · выбран наибольший Nd среди переданных контактов зоны.', x, y - 18, 7.4, color=MUTED, width=719)
        contact_front = [[front(point) for point in connection.get('worldContactPolygon') or []] for connection in contacts]
        profiles = [(member, self.projected_member(member, front)) for member in members]
        focus = [point for shape in contact_front for point in shape]
        if collar:
            focus += self.projected_member(collar, front)
        if not focus or not profiles:
            self.note(c, 'Физические доски или мировая геометрия контакта не переданы. Узел не достраивается по номинальным размерам.', y=600, color=ORANGE); return
        lo_x, lo_y, hi_x, hi_y = bounds(focus)
        front_box = (x, 411, 719, 256)
        fn, _ = transform([(lo_x - .2, lo_y - .3), (hi_x + .2, hi_y + .3)], front_box, 15)
        c.saveState(); clip = c.beginPath(); clip.rect(*front_box); c.clipPath(clip, stroke=0)
        for member, shape in sorted(profiles, key=lambda item: 1 if item[0].get('role') == 'collarTie' else 0):
            is_collar = member.get('role') == 'collarTie'
            polygon(c, [fn(point) for point in shape], colors.Color(.74, .86, .72, alpha=.65) if is_collar else WOOD, GREEN if is_collar else WOOD_DARK, .9)
        for shape in contact_front:
            polygon(c, [fn(point) for point in shape], colors.Color(1, .57, .18, alpha=.45), ORANGE, 1.1)
        c.restoreState()
        for i, shape in enumerate(contact_front):
            center = fn((sum(point[0] for point in shape) / len(shape), sum(point[1] for point in shape) / len(shape)))
            label = (center[0], center[1] - 37)
            line(c, center, label, ORANGE, .65); c.setFillColor(colors.white); c.setStrokeColor(ORANGE); c.circle(*label, 9, fill=1, stroke=1)
            text(c, 'К' + str(i + 1), label[0] - 6, label[1] - 2.5, 7, 'Bold', ORANGE)
        if collar:
            collar_shape = self.projected_member(collar, front); a, b, d, e = bounds(collar_shape)
            dimension(c, fn((d, b)), fn((d, e)), -21, number((e - b) * 1000, 0))
        text(c, 'Оранжевым - фактические участки контакта широких граней. Совпадение силуэтов ригеля и стропил здесь намеренное: древесина находится в разных боковых плоскостях.', x, 390, 7.8, color=ORANGE, width=719)
        tx, ty, tw = 799, y, W - 842
        text(c, 'ФАКТИЧЕСКАЯ ДЕТАЛЬ', tx, ty, 10, 'Bold', GREEN); ty -= 28
        if collar:
            mark = self.marks.get(str(collar.get('id')), '-')
            cuts = [collar.get('cutStart') or {}, collar.get('cutEnd') or {}]
            ends = 'Прямые торцы 90°' if all(cut.get('scheme') == 'butt' and abs(finite(cut.get('angle'))) < 1e-8 for cut in cuts) else self.ends(*cuts)
            for label, value in [('Марка / сечение', mark + ' · ' + clean(collar.get('b')) + ' × ' + clean(collar.get('h')) + ' мм'), ('Длина заготовки', number(finite(collar.get('cutLength', collar.get('length'))) * 1000, 2) + ' мм'), ('Торцы', ends)]:
                text(c, label, tx, ty, 7.2, color=MUTED); ty = text(c, value, tx, ty - 17, 10, 'Bold', width=tw) - 22
        marks = list(dict.fromkeys(self.marks.get(str(member.get('id')), '-') for member in members if member.get('role') == 'topChord'))
        ty = text(c, 'Стропила: ' + ', '.join(marks) + '. Накладка установлена со стороны +U; исходные доски и контакты связаны мировыми IDs в JSON.', tx, ty - 2, 8, width=tw) - 21
        badge(c, 'КРЕПЁЖ НЕ ПОДОБРАН', tx, ty, ORANGE)
        note_bottom = text(c, 'N × e - масштаб эксцентриситета. Это не расчёт гвоздей, не жёсткость узла и не результат пространственной рамы.', tx, ty - 35, 8.5, 'Bold', ORANGE, width=tw)
        envelope = self.collar_lap_snow_envelope(zone)
        if envelope:
            connection = envelope['connection']
            text(c, 'Огибающая снеговых сценариев зоны: ' + ', '.join(envelope['caseIds']) + '. Nd=' + number(connection.get('demandKN'), 3) + ' кН; N × e=' + number(connection.get('axisOffsetMomentScaleKNm'), 4) + ' кНм. Это отдельный расчётный сценарий, не сила выбранного ряда.', tx, note_bottom - 20, 7.3, color=ORANGE, width=tw)
        # A plan of the same physical bodies retains their real extrusion widths.
        px, py, pw, ph = 43, 143, 510, 220
        c.setStrokeColor(LINE); c.rect(px, py, pw, ph, fill=0, stroke=1)
        text(c, 'ФРАГМЕНТ ПЛАНА К1 · ПОПЕРЕЧНАЯ ТОЛЩИНА', px + 10, py + ph - 20, 8.5, 'Bold', GREEN)
        first = contacts[0]; ids = set(str(member_id) for member_id in first.get('memberWorldIds') or [])
        pair = [member for member in members if str(member.get('id')) in ids]
        shapes = [(member, self.projected_member(member, plan)) for member in pair]
        plan_contact = [plan(point) for point in first.get('worldContactPolygon') or []]
        all_points = [point for _, shape in shapes for point in shape]
        if shapes and plan_contact:
            min_u, _, max_u, _ = bounds(all_points); _, min_v, _, max_v = bounds(plan_contact)
            center_v = (min_v + max_v) / 2
            view_min_v, view_max_v = center_v - .07, center_v + .07
            plan_box = (px + 12, py + 60, pw - 24, ph - 96)
            pf, _ = transform([(min_u - .025, view_min_v), (max_u + .025, view_max_v)], plan_box, 8)
            c.saveState(); clip = c.beginPath(); clip.rect(*plan_box); c.clipPath(clip, stroke=0)
            for member, shape in shapes:
                is_collar = member.get('role') == 'collarTie'
                polygon(c, [pf(point) for point in shape], colors.HexColor('#dce8d5') if is_collar else WOOD, GREEN if is_collar else WOOD_DARK, .9)
            contact_u = sum(point[0] for point in plan_contact) / len(plan_contact)
            line(c, pf((contact_u, min_v)), pf((contact_u, max_v)), ORANGE, 1.7)
            c.restoreState()
            for member, shape in shapes:
                a, b, d, e = bounds(shape)
                dimension(c, pf((a, view_min_v)), pf((d, view_min_v)), -15, number((d - a) * 1000, 0))
            centers = [(member.get('role'), (bounds(shape)[0] + bounds(shape)[2]) / 2) for member, shape in shapes]
            for _, center in centers:
                line(c, pf((center, view_min_v)), pf((center, view_max_v)), MUTED, .45, [3, 2])
            if len(centers) == 2:
                uu = sorted(center for _, center in centers)
                dimension(c, pf((uu[0], view_min_v)), pf((uu[1], view_min_v)), -34, 'e ' + number((uu[1] - uu[0]) * 1000, 1))
        text(c, 'Показан ограниченный фрагмент плана, не отдельная короткая деталь. Толщины - по физическим граням, e - между осями. Доски касаются широкой гранью.', px + 10, py + 12, 6.9, color=MUTED, width=pw - 20)
        # Connection numbers are transferred verbatim, without connector design.
        qx, qy, qw = 586, 345, W - 629
        text(c, 'КОНТАКТ И УСИЛИЕ ВЫБРАННОГО РЯДА', qx, qy, 9, 'Bold', GREEN); qy -= 20
        columns = [('Узел / участники', .31), ('A, м²', .16), ('Nd, кН', .15), ('e, мм', .14), ('N × e, кНм', .24)]
        c.setFillColor(INK); c.rect(qx, qy - 24, qw, 24, fill=1, stroke=0)
        left = qx
        for label, fraction in columns:
            text(c, label, left + 5, qy - 15, 6.7, 'Bold', colors.white); left += qw * fraction
        qy -= 24
        for i, connection in enumerate(contacts):
            values = ['К' + str(i + 1) + ' · ' + clean(connection.get('id')) + '\n' + ' / '.join(clean(member) for member in connection.get('members') or []), number(connection.get('contactAreaM2'), 6), number(connection.get('demandKN'), 3), number(finite(connection.get('eccentricityM')) * 1000, 1) if optional_number(connection.get('eccentricityM')) is not None else '-', number(connection.get('axisOffsetMomentScaleKNm'), 4)]
            height = max(47, max(len(wrap(value, qw * fraction - 10, 'Body', 7)) for value, (_, fraction) in zip(values, columns)) * 8.7 + 12)
            c.setFillColor(PAPER if i % 2 == 0 else colors.white); c.rect(qx, qy - height, qw, height, fill=1, stroke=0)
            left = qx
            for value, (_, fraction) in zip(values, columns):
                text(c, value, left + 5, qy - 13, 7, width=qw * fraction - 10); left += qw * fraction
            qy -= height
        text(c, 'Площадь контакта не задаёт несущую способность. Число, диаметр, длина и схема крепежа отсутствуют; смятие, отрыв, срез, эксцентриситет и пространственная работа узла не подтверждены.', qx, qy - 17, 7.3, color=ORANGE, width=qw)
        self.note(c, 'Контакт и поперечное положение досок - по фактической 3D-геометрии. Усилия выбранного ряда и огибающая снеговых сценариев показаны раздельно; модель 2D сохраняет свои аналитические оси.', y=108, color=MUTED)

    def draw_roof_seats(self, c, zone, roof_profiles, local, box):
        bounds_ = zone.get('bearingBounds') or zone.get('bounds') or {}
        low, high, eave = optional_number(bounds_.get('minV')), optional_number(bounds_.get('maxV')), optional_number(zone.get('eave'))
        if low is None or high is None or eave is None:
            text(c, 'Координаты опорных сечений не переданы.', box[0], box[1] + 30, 7.5, color=ORANGE); return
        angle = math.radians(finite(zone.get('ridgeAngle')))
        station = lambda point: -math.sin(angle) * xy(point)[0] + math.cos(angle) * xy(point)[1]
        for side, center in enumerate((low, high)):
            x, y, w, h = box[0] + side * (box[2] / 2 + 6), box[1], box[2] / 2 - 12, box[3]
            c.setStrokeColor(LINE); c.rect(x, y, w, h, fill=0, stroke=1)
            text(c, 'ПОСАДКА · КАРНИЗ ' + str(side + 1), x + 8, y + h - 16, 7.5, 'Bold', GREEN)
            profiles = list(roof_profiles)
            wall_ids = {str(wall.get('id')) for wall in self.p.get('walls') or [] if int(wall.get('level', 1)) == int(zone.get('levelIndex', 1)) and abs(station(wall.get('a')) - station(wall.get('b'))) < 1e-6 and abs(station(wall.get('a')) - center) < .02}
            profiles += [(m, self.projected_member(m, local)) for m in self.members if m.get('category') == 'walls' and str(m.get('wallId')) in wall_ids and m.get('start') and m.get('end') and m.get('role') in ('stud', 'plate', 'corner')]
            fn, _ = transform([(center - .27, eave - .18), (center + .27, eave + .32)], (x + 7, y + 23, w - 14, h - 49), 6)
            c.saveState(); clip = c.beginPath(); clip.rect(x + 7, y + 23, w - 14, h - 49); c.clipPath(clip, stroke=0)
            seen = set()
            for member, shape in sorted(profiles, key=lambda entry: 0 if entry[0].get('category') == 'walls' else 1):
                key = tuple(sorted((round(point[0], 5), round(point[1], 5)) for point in shape))
                if key in seen: continue
                seen.add(key)
                color = GREEN if member.get('category') == 'walls' else WOOD_DARK
                polygon(c, [fn(p) for p in shape], colors.HexColor('#e0e8d8') if member.get('category') == 'walls' else colors.HexColor('#eee0c6'), color, .7)
            line(c, fn((center - .27, eave)), fn((center + .27, eave)), BLUE, .55, [3, 2])
            c.restoreState()
            text(c, 'Опорная отметка +' + number(eave, 3) + ' м · фактические тела', x + 8, y + 10, 6.5, color=MUTED, width=w - 16)

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
        variants = [('openTerrace', '01 · Открытая терраса', 'Открытый настил. Основание задаётся проектом: общее с домом либо самостоятельное. Кровля и остекление отсутствуют.'), ('coveredTerrace', '02 · Крытая открытая веранда', 'Настил, стойки и односкатная кровля. Ростверк может быть общим с домом. Сток направлен от дома.'), ('glazedVeranda', '03 · Холодная остеклённая веранда', 'Неотапливаемое остекление, каркас и кровля. Режим основания задаётся проектом. Тепловой контур дома сохраняется.')]
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
            piles = (item.get('foundation') or {}).get('piles') or [p for p in self.r.get('piles') or [] if p.get('annexId') == item.get('id')]
            row = clean(item.get('name', item.get('id'))) + ': ' + number(item.get('area'), 2) + ' м²; ' + ('опоры общей рамы: ' if (item.get('foundation') or {}).get('shared') else 'сваи: ') + str(len(piles)) + '; физических досок: ' + str(len(members)) + '; панелей остекления: ' + str(len(item.get('glazing') or [])) + '.'
            y = text(c, row, 47, y, 10, width=W - 100) - 21
        self.note(c, 'Количество и стоимость берутся только из заданной геометрии текущего проекта. Варианты без геометрии не получают вымышленные размеры, материалы или цену. Общие планы дома и отапливаемая площадь сохраняют самостоятельные границы.', y=157)

    def draw_annex(self, c, annex, index):
        aid = annex.get('id'); members = [m for m in self.members if m.get('annexId') == aid]
        shared = bool((annex.get('foundation') or {}).get('shared'))
        pile_refs = (annex.get('foundation') or {}).get('piles') or [p for p in self.r.get('piles') or [] if p.get('annexId') == aid]
        canonical_piles = {p.get('id'): p for p in self.r.get('piles') or []}
        piles = [canonical_piles.get(p.get('id'), p) for p in pile_refs]
        foundation_ids = {b.get('id') for b in (annex.get('foundation') or {}).get('beams') or []}
        foundation_members = [m for m in self.gr.get('instances') or [] if m.get('beamId') in foundation_ids] if shared else []
        drawing_members = members + foundation_members
        poly = [xy(p) for p in annex.get('polygon') or []]
        text(c, 'ПЛАН · НАСТИЛ, ОБЩИЙ РОСТВЕРК И КРОВЛЯ' if shared else 'ПЛАН · НАСТИЛ, САМОСТОЯТЕЛЬНОЕ ОСНОВАНИЕ И КРОВЛЯ', 48, H - 135, 9, 'Bold', GREEN)
        fn, scale = transform(poly + [(p.get('x', 0), p.get('y', 0)) for p in piles], (48, 345, 495, 309), 35)
        polygon(c, [fn(p) for p in poly], PAPER, GREEN, 1)
        if foundation_members and poly:
            c.saveState(); clip = c.beginPath(); clip.moveTo(*fn(poly[0]))
            for point in poly[1:]: clip.lineTo(*fn(point))
            clip.close(); c.clipPath(clip, stroke=0)
            for member in foundation_members:
                polygon(c, [fn(point) for point in self.projected_member(member, lambda q: (q[0], q[2]))], colors.HexColor('#e9d6b6'), BLUE, .55)
            c.restoreState()
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
        profiles = [(m, self.projected_member(m, project)) for m in drawing_members]
        surfaces = [(s, [project(xyz(p)) for p in s.get('points') or []]) for s in (annex.get('roof') or {}).get('surfaces') or []]
        glazing = [(s, [project(xyz(p)) for p in s.get('polygon') or []]) for s in annex.get('glazing') or []]
        points = [p for m, shape in profiles if m not in foundation_members for p in shape] + [p for _, shape in surfaces + glazing for p in shape]
        points += [project((finite(p.get('x')), -.12, finite(p.get('y')))) for p in piles]
        sf, _ = transform(points or [(0, 0), (1, 1)], (600, 345, W - 650, 310), 35)
        for p in piles:
            low = project((finite(p.get('x')), -.12, finite(p.get('y')))); top = project((finite(p.get('x')), finite(p.get('capTopY', p.get('headY')), .72), finite(p.get('y'))))
            line(c, sf(low), sf(top), GREEN, 3)
        c.saveState(); clip = c.beginPath()
        if shared and poly:
            depth = [(point[0] - origin[0]) * normal[0] + (point[1] - origin[1]) * normal[1] for point in poly]
            left = max(600, sf((min(depth) - .05, 0))[0]); right = min(W - 50, sf((max(depth) + .4, 0))[0])
            clip.rect(left, 345, max(0, right - left), 310)
        else:
            clip.rect(600, 345, W - 650, 310)
        c.clipPath(clip, stroke=0)
        for m, shape in profiles:
            polygon(c, [sf(p) for p in shape], WOOD, WOOD_DARK, .5)
        c.restoreState()
        if shared:
            text(c, 'Общая рама продолжается в дом; целиком - на монтажном плане.', 600, 325, 7, color=BLUE, width=W - 650)
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
        facts = [('ID / тип', clean(aid) + ' / ' + clean(annex.get('kind'))), ('Площадь настила / отметка', number(annex.get('area'), 2) + ' м² / +' + number(annex.get('deckTopY'), 3) + ' м'), ('Доски / объём физических деталей', str(len(members)) + ' / ' + number(sum(finite(m.get('grossVolume', m.get('volume'))) for m in members), 4) + ' м³'), ('Сечения', '; '.join(f'{b} × {h}: {count} шт.' for (b, h), count in sections.items())), ('Общие опоры / глобальные Fd' if shared else 'Сваи / реакции Fd', str(len(piles)) + ' / ' + '; '.join('A' + str(i + 1) + '=' + number(p.get('reaction'), 2) for i, p in enumerate(piles)) + ' кН')]
        for name, value in facts:
            text(c, name, 48, y, 7.5, color=MUTED); y = text(c, value, 222, y, 7.5, width=330) - 13
        x, y = 600, 287
        text(c, 'СОСТАВ И ГРАНИЦЫ ПРОВЕРКИ', x, y, 10, 'Bold', GREEN); y -= 28
        thermal_note = 'Остеклённая веранда остаётся неотапливаемой; тепловой контур дома не расширен.' if annex.get('kind') == 'glazedVeranda' else 'Открытая пристройка не увеличивает отапливаемую площадь дома.'
        items = ['Кровля: ' + ('есть' if roof.get('surfaces') else 'не задана') + '; остекление: ' + str(len(annex.get('glazing') or [])) + ' панелей.', thermal_note, 'Опоры, примыкание и отвод воды показаны по отчёту. Грунт, крепёж, анкеры, устойчивость и узлы влагоотвода требуют проектирования.']
        for item in items:
            y = text(c, item, x, y, 8.3, width=525) - 15
        self.note(c, 'Показан компонент общей рамы. Реакции Fd взяты из канонического общего реестра свай. Смешанные балки ростверка учтены один раз в общей спецификации; здесь не добавляются к количеству досок пристройки.' if shared else 'План и проекция построены только по фактическим деталям и поверхностям. Цифры A1… связывают сваи на этом листе; полные IDs, FG и FP доступны в CSV / JSON.', y=99)

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
