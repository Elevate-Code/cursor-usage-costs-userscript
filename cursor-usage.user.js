// ==UserScript==
// @name         Cursor Usage Costs
// @namespace    https://github.com/Elevate-Code
// @version      1.2.5
// @description  Adds a 'Cost ($)' column, a total cost summary, and a resilient hourly usage chart (with text fallback) to the Cursor usage page.
// @author       Elevate Code (Dimitri Sudomoin)
// @match        https://www.cursor.com/dashboard*
// @match        https://cursor.com/dashboard*
// @homepageURL  https://github.com/Elevate-Code/cursor-usage-costs-userscript
// @supportURL   https://github.com/Elevate-Code/cursor-usage-costs-userscript/issues
// @require      https://code.highcharts.com/highcharts.js
// @downloadURL  https://raw.githubusercontent.com/Elevate-Code/cursor-usage-costs-userscript/main/cursor-usage.user.js
// @updateURL    https://raw.githubusercontent.com/Elevate-Code/cursor-usage-costs-userscript/main/cursor-usage.user.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';
    console.log('[CUE] Cursor Usage Costs script started (v1.2.0).');

    const SCRIPT_ID = 'cursor-usage-cost-script';
    const CHART_ID = 'cursor-usage-chart-container';
    const SUMMARY_ID = 'cursor-usage-summary-line';
    const FALLBACK_CHART_ID = 'cursor-usage-fallback-chart';
    let usageChart = null;
    let observer;

    /**
     * Debounces a function to limit the rate at which it gets called.
     * @param {Function} func The function to debounce.
     * @param {number} wait The timeout in milliseconds.
     * @returns {Function} The debounced function.
     */
    function debounce(func, wait) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    /**
     * Main function to process the page, triggered by DOM changes.
     * Disconnects the observer, checks if on the correct tab, and orchestrates DOM updates.
     */
    function processPage() {
        observer.disconnect();

        try {
            if (!window.location.search.includes('tab=usage')) {
                if (usageChart) usageChart.destroy();
                usageChart = null;
                document.getElementById(CHART_ID)?.remove();
                document.getElementById(SUMMARY_ID)?.remove();
                document.getElementById(FALLBACK_CHART_ID)?.remove();
                return;
            }

            const table = document.querySelector('table');
            if (!table) return;

            const chartData = getChartData(table);
            if (!chartData || chartData.length === 0) {
                 if (usageChart) usageChart.destroy();
                 usageChart = null;
                 document.getElementById(CHART_ID)?.remove();
                 document.getElementById(SUMMARY_ID)?.remove();
                 document.getElementById(FALLBACK_CHART_ID)?.remove();
                 return;
            }

            try {
                if (typeof Highcharts !== 'undefined') {
                    document.getElementById(FALLBACK_CHART_ID)?.remove();
                    renderOrUpdateUsageChart(chartData, table);
                } else {
                    if (usageChart) usageChart.destroy();
                    usageChart = null;
                    document.getElementById(CHART_ID)?.remove();
                    renderOrUpdateTextFallback(chartData, table);
                }
            } catch (e) {
                console.error('[CUE] Failed to render chart visualization.', e);
            }

            try {
                renderOrUpdateSummaryLine(chartData, table);
            } catch (e) {
                console.warn('[CUE] Could not render summary line.', e);
            }

        } catch(e) {
            console.error('[CUE] A critical error occurred in processPage.', e);
        }
        finally {
            observer.observe(document.body, { childList: true, subtree: true });
        }
    }

    /**
     * Extracts time, cost, and kind data from the table.
     * @param {HTMLTableElement} table The usage table element.
     * @returns {Array<Object>} An array of data points with time, cost, and kind.
     */
    function getChartData(table) {
        const rows = table.querySelectorAll('tbody tr');
        const data = [];
        rows.forEach(row => {
            const dateCell = row.querySelector('td:first-child');
            const kindCell = row.querySelector('td:nth-child(3)');
            const costCell = row.querySelector('td:last-child');

            const dateTitle = dateCell?.getAttribute('title');
            const kind = kindCell?.getAttribute('title');

            if (dateTitle && kind && costCell) {
                let cost = NaN;
                const span = costCell.querySelector('span');
                let costText;

                if (span && span.title.includes('$')) {
                    costText = span.title;
                } else {
                    costText = costCell.textContent;
                }

                if (costText) {
                    const costMatch = costText.match(/\$([\d.]+)/);
                    if (costMatch && costMatch[1]) {
                        cost = parseFloat(costMatch[1]);
                    }
                }

                if (!isNaN(cost)) {
                    data.push({ time: new Date(dateTitle), cost: cost, kind: kind });
                }
            }
        });
        return data;
    }

    /**
     * Aggregates cost data by the hour for the chart, separated by kind.
     * @param {Array<Object>} data The raw data from getChartData.
     * @returns {Object} An object containing aggregated data for included and usage-based costs.
     */
    function aggregateDataByHour(data) {
        const includedHourly = {};
        const usageBasedHourly = {};
        const dataWithCost = data.filter(item => item.cost > 0);

        dataWithCost.forEach(item => {
            const date = item.time;
            const hour = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours());

            if (item.kind.includes('Included')) {
                includedHourly[hour] = (includedHourly[hour] || 0) + item.cost;
            } else if (item.kind.includes('Usage-based')) {
                usageBasedHourly[hour] = (usageBasedHourly[hour] || 0) + item.cost;
            }
        });

        const formatForChart = (hourlyData) => Object.entries(hourlyData)
            .map(([time, cost]) => [parseInt(time), parseFloat(cost.toFixed(2))])
            .sort((a, b) => a[0] - b[0]);

        return {
            included: formatForChart(includedHourly),
            usageBased: formatForChart(usageBasedHourly)
        };
    }

    /**
     * Returns the configuration object for the Highcharts chart.
     * @param {boolean} isDarkMode Whether dark mode is enabled.
     * @param {Object} aggregatedData The data for the chart series.
     * @returns {Object} The Highcharts options object.
     */
    function getChartOptions(isDarkMode, aggregatedData) {
        return {
            chart: { type: 'spline', backgroundColor: 'transparent', zoomType: 'x' },
            title: { text: 'Hourly Usage Cost', style: { color: isDarkMode ? 'white' : 'black' } },
            xAxis: {
                type: 'datetime',
                labels: { style: { color: isDarkMode ? '#a0a0a0' : '#333' } },
                lineColor: isDarkMode ? '#404040' : '#ccd6eb',
                tickColor: isDarkMode ? '#404040' : '#ccd6eb'
            },
            yAxis: {
                title: { text: 'Cost ($)', style: { color: isDarkMode ? '#a0a0a0' : '#333' } },
                labels: { format: '${value:.2f}', style: { color: isDarkMode ? '#a0a0a0' : '#333' } },
                gridLineColor: isDarkMode ? '#2a2a2a' : '#e6e6e6',
                min: 0
            },
            tooltip: {
                backgroundColor: isDarkMode ? 'rgba(30, 30, 30, 0.85)' : 'rgba(255, 255, 255, 0.85)',
                style: { color: isDarkMode ? 'white' : 'black' },
                headerFormat: '<span style="font-size: 10px">{point.key:%A, %b %e, %H:00}</span><br/>',
                pointFormat: '{series.name}: <b>${point.y:.2f}</b>',
                shared: true
            },
            legend: {
                enabled: true,
                itemStyle: {
                    color: isDarkMode ? '#a0a0a0' : '#333'
                }
            },
            series: [{
                name: 'Included Cost',
                data: aggregatedData.included,
                color: '#88C0D0'
            }, {
                name: 'Overage Cost',
                data: aggregatedData.usageBased,
                color: '#BF616A'
            }],
            credits: { enabled: false },
            accessibility: { enabled: false }
        };
    }

    /**
     * Renders or updates the hourly usage chart.
     * @param {Array<Object>} chartData The raw data from getChartData.
     * @param {HTMLTableElement} table The usage table element.
     */
    function renderOrUpdateUsageChart(chartData, table) {
        const aggregatedData = aggregateDataByHour(chartData);

        if (aggregatedData.included.length === 0 && aggregatedData.usageBased.length === 0) {
            if (usageChart) {
                usageChart.destroy();
                usageChart = null;
            }
            document.getElementById(CHART_ID)?.remove();
            return;
        }

        Highcharts.setOptions({ global: { useUTC: false } });

        const inclSig = aggregatedData.included;
        const usageSig = aggregatedData.usageBased;
        const newDataSignature = `${inclSig.length}:${inclSig[0]?.[0]}:${inclSig.at(-1)?.[0]}:${usageSig.length}:${usageSig[0]?.[0]}:${usageSig.at(-1)?.[0]}`;

        if (usageChart) {
             if (usageChart.cueDataSignature !== newDataSignature) {
                usageChart.series[0].setData(aggregatedData.included, false);
                usageChart.series[1].setData(aggregatedData.usageBased, true);
                usageChart.cueDataSignature = newDataSignature;
            }
        } else {
            let container = document.getElementById(CHART_ID);
            if (!container) {
                container = document.createElement('div');
                container.id = CHART_ID;
                container.style.height = '400px';
                container.style.marginBottom = '20px';
                const heading = Array.from(document.querySelectorAll('p')).find(p => p.textContent.trim() === 'Filtered Usage Events');
                if (heading && heading.parentElement) {
                    heading.parentElement.insertAdjacentElement('afterend', container);
                } else {
                    table.parentNode.insertBefore(container, table);
                }
            }
            const isDarkMode = document.documentElement.classList.contains('dark');
            usageChart = Highcharts.chart(CHART_ID, getChartOptions(isDarkMode, aggregatedData));
            usageChart.cueDataSignature = newDataSignature;
        }
    }

    /**
     * Renders a text-based fallback if Highcharts is not available.
     * @param {Array<Object>} chartData The raw data from getChartData.
     * @param {HTMLTableElement} table The usage table element.
     */
    function renderOrUpdateTextFallback(chartData, table) {
        const aggregatedData = aggregateDataByHour(chartData);
        let fallbackEl = document.getElementById(FALLBACK_CHART_ID);

        if (aggregatedData.included.length === 0 && aggregatedData.usageBased.length === 0) {
            if (fallbackEl) fallbackEl.remove();
            return;
        }

        const isDarkMode = document.documentElement.classList.contains('dark');

        const formatText = (data, title) => {
            if (data.length === 0) return '';
            const content = data.map(([time, cost]) => {
                const d = new Date(time);
                const dateStr = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                const timeStr = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
                return `${dateStr}, ${timeStr}: $${cost.toFixed(2)}`;
            }).join('\n');
            return `<h4 style="margin: 10px 0 5px; font-weight: bold; color: ${isDarkMode ? 'white' : 'black'};">${title}</h4>${content}`;
        };

        const includedText = formatText(aggregatedData.included, 'Included Cost');
        const usageBasedText = formatText(aggregatedData.usageBased, 'Overage Cost');

        const inclSig = aggregatedData.included;
        const usageSig = aggregatedData.usageBased;
        const newSignature = `${inclSig.length}:${inclSig[0]?.[0]}:${usageSig.length}:${usageSig[0]?.[0]}`;
        const newHtml = `<h3 style="margin: 0 0 10px; font-weight: bold; color: ${isDarkMode ? 'white' : 'black'};">Hourly Usage Cost (Fallback)</h3>${includedText}${usageBasedText}`;

        if (fallbackEl && fallbackEl.cueDataSignature === newSignature) {
            return;
        }

        if (!fallbackEl) {
            fallbackEl = document.createElement('div');
            fallbackEl.id = FALLBACK_CHART_ID;
            Object.assign(fallbackEl.style, {
                backgroundColor: isDarkMode ? '#1e1e1e' : '#f8f9fa',
                border: `1px solid ${isDarkMode ? '#404040' : '#e9ecef'}`,
                borderRadius: '8px',
                padding: '16px',
                marginBottom: '20px',
                fontFamily: 'monospace',
                whiteSpace: 'pre-wrap',
                color: isDarkMode ? '#a0a0a0' : '#333',
                fontSize: '12px',
            });
            const heading = Array.from(document.querySelectorAll('p')).find(p => p.textContent.trim() === 'Filtered Usage Events');
            if (heading && heading.parentElement) {
                heading.parentElement.insertAdjacentElement('afterend', fallbackEl);
            } else {
                table.parentNode.insertBefore(fallbackEl, table);
            }
        }

        fallbackEl.innerHTML = newHtml;
        fallbackEl.cueDataSignature = newSignature;
    }

    /**
     * Renders or updates the summary line with total cost and date range.
     * @param {Array<Object>} chartData The raw data from getChartData.
     * @param {HTMLTableElement} table The usage table element.
     */
    function renderOrUpdateSummaryLine(chartData, table) {
        if (chartData.length === 0) {
            document.getElementById(SUMMARY_ID)?.remove();
            return;
        }

        const includedCost = chartData.filter(i => i.kind.includes('Included')).reduce((sum, item) => sum + item.cost, 0);
        const usageBasedCost = chartData.filter(i => i.kind.includes('Usage-based')).reduce((sum, item) => sum + item.cost, 0);

        const dates = chartData.map(item => item.time);
        const maxDate = dates[0];
        const minDate = dates[dates.length - 1];

        const formatTime = (date) => date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        const formatDate = (date) => date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

        let dateRangeStr;
        if (minDate.toDateString() === maxDate.toDateString()) {
            dateRangeStr = `${formatDate(minDate)}, ${formatTime(minDate)} - ${formatTime(maxDate)}`;
        } else {
            dateRangeStr = `${formatDate(minDate)} ${formatTime(minDate)} - ${formatDate(maxDate)} ${formatTime(maxDate)}`;
        }

        const summaryText = `Total for visible range (${dateRangeStr}): Included Value $${includedCost.toFixed(2)} | Overage $${usageBasedCost.toFixed(2)}`;

        let summaryEl = document.getElementById(SUMMARY_ID);
        if (!summaryEl) {
            summaryEl = document.createElement('p');
            summaryEl.id = SUMMARY_ID;
            const isDarkMode = document.documentElement.classList.contains('dark');
            Object.assign(summaryEl.style, {
                color: isDarkMode ? '#a0a0a0' : '#6c757d',
                margin: '0 0 20px 0',
                textAlign: 'center',
                fontFamily: 'sans-serif',
                fontSize: '14px'
            });

            const chartContainer = document.getElementById(CHART_ID);
            const fallbackContainer = document.getElementById(FALLBACK_CHART_ID);
            const heading = Array.from(document.querySelectorAll('p')).find(p => p.textContent.trim() === 'Filtered Usage Events');

            if (chartContainer) {
                chartContainer.insertAdjacentElement('afterend', summaryEl);
            } else if (fallbackContainer) {
                fallbackContainer.insertAdjacentElement('afterend', summaryEl);
            } else if (heading && heading.parentElement) {
                heading.parentElement.insertAdjacentElement('afterend', summaryEl);
            } else {
                table.parentNode.insertBefore(summaryEl, table);
            }
        }

        if (summaryEl.textContent !== summaryText) {
            summaryEl.textContent = summaryText;
        }
    }

    const debouncedProcessPage = debounce(processPage, 300);

    observer = new MutationObserver(debouncedProcessPage);
    observer.observe(document.body, { childList: true, subtree: true });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', debouncedProcessPage);
    } else {
        debouncedProcessPage();
    }
})();
