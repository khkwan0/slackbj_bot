#!/bin/bash
single=single/$1
t=tmp_$1
id=$1
mkdir -p ${single}/good
mkdir -p ${single}/bad
end=$2

#head -n 1000 useridlist.txt | tail | while read id
  echo -n "${id}_combined_html... "
  node report.js -u ${id} -e ${end} -n -z -- > ${t}.html 2> ${t}.err
  res=$?
  if [ $res -eq 5 ]; then
    echo nobalance
  elif [ $res -eq 0 ]; then
    mv ${t}.html ${single}/good/yieldapp_${id}_combined_statement_${end}.html
    echo good
    echo -n "${id} csv reports..."
    node wallet_detail_csv_2021.js -u ${id} -e ${end} -n -z 0.00 > ${t}.csv 2> ${t}.err
    mv ${t}.csv ${single}/good/yieldapp_${id}_wallet_detail_${end}.csv
    node wallet_summary_csv_2021.js -u ${id} -e ${end} -n -z 0.00 > ${t}.csv 2> ${t}.err
    mv ${t}.csv ${single}/good/yieldapp_${id}_wallet_summary_${end}.csv
    node portfolio_detail_csv_2021.js -u ${id} -e ${end} -n -z 0.00 > ${t}.csv 2> ${t}.err
    mv ${t}.csv ${single}/good/yieldapp_${id}_portfolio_detail_${end}.csv
    node portfolio_summary_csv_2021.js -u ${id} -e ${end} -n -z 0.00 > ${t}.csv 2> ${t}.err
    mv ${t}.csv ${single}/good/yieldapp_${id}_portfolio_summary_${end}.csv
    echo done
  else
    mv ${t}.html ${single}/bad/yieldapp_${id}_combined_statement_2021.html
    mv ${t}.err ${single}/bad/yieldapp_${id}_combined_statement_2021.err
    echo bad
  fi

rm -f ${t}.html ${t}.err
