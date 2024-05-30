FROM python:3.6.15-bullseye
RUN apt update && apt install telnet
RUN git clone https://github.com/UrusovVladimir/flask-remote-terminal.git
WORKDIR /flask-remote-terminal
RUN rm ./config_sample.py
RUN  <<EOF cat >> ./config.py
TERM_INIT_CONFIG = {
    'domain': '{{ moxa_ip }}', # or ip address like 192.168.10.11
    'client_path': {
        'telnet': '/usr/bin/telnet', # confirmed location of your client binary (with cmd like 'which telnet')
    }
}
EOF
RUN python3 -m venv venv
RUN . venv/bin/activate
RUN venv/bin/pip install --upgrade pip
RUN pip3 install -r requirements.txt
CMD [ "python3.6", "app.py"]