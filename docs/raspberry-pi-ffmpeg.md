# Raspberry Pi FFmpeg Hardware Acceleration

Use these snippets to compile FFmpeg to support Raspberry Pi's H.264 OpenMAX hardware acceleration. This is recommended to greatly improve camera image quality and speed.

This set up has only been tested on a Raspberry Pi 3 B+ running Raspbian Lite 4.19.57, please note this may not work with other conifgurations.

## Install dependencies and compile FFmpeg
See complete instructions [here](https://retroresolution.com/2016/05/31/compiling-software-from-source-code-on-the-raspberry-pi-the-ffmpeg-suite/).

```
# Install Kernel Headers (for MMAL hardware decoding)
sudo apt-get update
sudo apt-get install raspberrypi-kernel-headers
sudo reboot

# Install OpenMAX library
sudo apt-get install libomxil-bellagio-dev

cd ~
mkdir ~/ffmpeg_sources
mkdir ~/ffmpeg_build
sudo apt-get install yasm

# Install x264 library
cd /home/pi/ffmpeg_sources
git clone git://git.videolan.org/x264
cd x264
./configure --host=arm-unknown-linux-gnueabi --enable-shared --disable-opencl
sudo make -j2
sudo make install
sudo make clean
sudo make distclean

# Install fdkaac library
cd ~/ffmpeg_sources
wget -O fdk-aac.tar.gz https://github.com/mstorsjo/fdk-aac/tarball/master
tar xzvf fdk-aac.tar.gz
cd mstorsjo-fdk-aac*
autoreconf -fiv
./configure  --enable-shared
sudo make -j2
sudo make install
sudo make clean
sudo make distclean

# Install additional libraries
sudo apt-get install libmp3lame-dev
sudo apt-get install libopus-dev
sudo apt-get install libspeex-dev
sudo apt-get install libssl-dev

# Install ffmpeg
cd ~/ffmpeg_sources
wget http://ffmpeg.org/releases/ffmpeg-snapshot.tar.bz2
tar xjvf ffmpeg-snapshot.tar.bz2
cd ffmpeg
PATH="$HOME/bin:$PATH" ./configure --pkg-config-flags="--static" --extra-cflags="-fPIC -I$HOME/ffmpeg_build/include" --extra-ldflags="-L$HOME/ffmpeg_build/lib" --enable-gpl --enable-libass --enable-libfdk-aac --enable-libfreetype --enable-libmp3lame --enable-libopus --enable-libtheora --enable-libvorbis --enable-omx --enable-omx-rpi --enable-mmal --enable-libx264 --enable-openssl --enable-libspeex --enable-nonfree --enable-pic --extra-ldexeflags=-pie --enable-shared
PATH="$HOME/bin:$PATH" make -j2
sudo make install
sudo make distclean
hash -r
sudo ldconfig
```

Then, type `ffmpeg` and check that ffmpeg is correctly installed.

Finally, find the path to ffmpeg using the command `which ffmpeg`.

## Configure Homebridge

Add `cameraOptions` in your `config.json` configuration as follows:
```
{
    "platform": "homebridge-simplisafe3.SimpliSafe 3",
    "name": "Home Alarm",
    "auth": {
        "username": "YOUR_USERNAME",
        "password": "YOUR_PASSWORD"
    },
    "cameras": true,
    "cameraOptions": {
        "ffmpegPath": "<< PATH TO FFMPEG >>",
        "sourceOptions": {
            "-vcodec": "h264_mmal"
        },
        "videoOptions": {
            "-vcodec": "h264_omx",
            "-tune": false,
            "-preset": false
        }
    }
}
```

If this doesn't work, try removing the `sourceOptions` and `videoOptions`.
