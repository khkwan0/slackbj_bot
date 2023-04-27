FROM node:alpine


RUN apk add bash
RUN apk add vim
RUN apk add git
RUN apk add zip
RUN apk add 7zip

COPY .vimrc /root

WORKDIR /usr/src/app

CMD /usr/bin/tail -f /dev/null
