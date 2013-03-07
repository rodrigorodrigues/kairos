/*! kairos v0.0.1 2013-03-06 */
/* global _: false */
(function(exports, _) {

  /**
   * Calculates the start time of the next tick, optionally synchronized to the
   * users clock.
   *
   * @private
   * @method  nextTick
   *
   * @param  {Number}         now       Current timestamp
   * @param  {Number}         interval  Length of a tick in milliseconds
   * @param  {Number|Boolean} sync      Should we sync? If true, sync to the same interval as the interval parameter. If a number, sync to that number of milliseconds on the user's clock
   *
   * @return {Number}
   */
  function nextTick (now, interval, sync) {
    return now +
      interval -
      (
        sync ?
          (now + interval) %
            (true === sync ?
              interval
              : sync)
          : 0
      );
  }

  /**
   * The tick event
   *
   * @private
   * @method  tick
   *
   * @publishes frameTicked
   * @publishes frameTicked/{name}
   */
  function tick () {
    if (this.isStarted() && !this.isEnded()) {
      var
        now,
        message = [
          this._data,
          (this._relatedTime - (new Date()).getTime()) || 0
        ];

      this._parent.publish('frameTicked', message);

      if (this._name) {
        this._parent.publish('frameTicked/' + this._name, message);
      }

      if (this._tickInterval) {
        now = (new Date()).getTime();
        this._tickTimeout = setTimeout(_.bind(tick, this), nextTick(now, this._tickInterval, this._syncTicks) - now);
      }
    }
  }

  /**
   * The end event
   *
   * @private
   * @method  end
   *
   * @publishes frameEnded
   * @publishes frameEnded/{name}
   */
  function end () {
    if (!this.isEnded()) {
      this._ended = true;

      clearTimeout(this._tickTimeout);

      var
        message = [
          this._data,
          (this._relatedTime - (new Date()).getTime()) || 0
        ];

      this._parent.logger.info('Ending Frame', this._name);
      this._parent.publish('frameEnded', message);

      if (this._name) {
        this._parent.publish('frameEnded/' + this._name, message);
      }
    }
  }

  /**
   * The start event. Starts ticks and schedules the end event
   *
   * @private
   * @method  start
   *
   * @publishes frameStarted
   * @publishes frameStarted/{name}
   */
  function start () {
    if (!this.isStarted()) {
      this._started = true;

      var
        message = [
          this._data,
          (this._relatedTime - (new Date()).getTime()) || 0
        ];

      this._parent.logger.info('Starting Frame', this._name);
      this._parent.publish('frameStarted', message);

      if (this._name) {
        this._parent.publish('frameStarted/' + this._name, message);
      }

      // QUESTION: should this be called immediately, or on a timeout?
      if (this._tickInterval) {
        tick.call(this);
      }

      if (Infinity !== this._endsAt) {
        setTimeout(_.bind(end, this), this._endsAt - (new Date()).getTime());
      }
    }
  }

  /**
   * Creates a new KairosFrame
   *
   * @public
   * @constructor
   *
   * @param {KairosScheduler} parent  The scheduler this frame belongs to
   * @param {Object}          frame   Normalized data about this frame
   */
  function KairosFrame (parent, frame) {
    this._parent = parent;
    this._name = frame.frameName;
    this._beginsAt = frame.begin;
    this._endsAt = frame.end;
    this._tickInterval = frame.interval;
    this._syncTicks = frame.sync;
    this._relatedTime = frame.relatedTo;
    this._data = frame.data;
    this._paused = false;
    this._started = false;
    this._ended = false;

    if (this._tickInterval) {
      this._parent.logger.info('Kairos Frame created that will tick every ' + this._tickInterval + 'ms from ' + this._beginsAt + ' until ' + this._endsAt);
    } else {
      this._parent.logger.info('Kairos Frame created that begins at ' + this._beginsAt + ' and ends at ' + this._endsAt);
    }
  }

  _.extend(KairosFrame.prototype, {

    /**
     * Start the frame
     *
     * @public
     * @method start
     */
    start: function () {
      var now = (new Date()).getTime();
      if (this._beginsAt <= now) {
        start.call(this);
      } else {
        setTimeout(_.bind(start, this), this._beginsAt - now);
      }
    },

    /**
     * Pause frame ticks
     *
     * @public
     * @method pause
     */
    pause: function () {
      clearTimeout(this._tickTimeout);
      this._paused = true;
    },

    /**
     * Resume paused frame ticking
     *
     * @public
     * @method resume
     */
    resume: function () {
      if (this.isPaused()) {
        this._paused = false;
        if (this.isStarted() && !this.isEnded()) {
          tick.call(this);
        }
      }
    },

    /**
     * Is the frame started?
     *
     * @public
     * @method   isStarted
     * @accessor
     *
     * @return {Boolean}
     */
    isStarted: function () {
      return this._started;
    },

    /**
     * Is the frame ended?
     *
     * @public
     * @method   isEnded
     * @accessor
     *
     * @return {Boolean}
     */
    isEnded: function () {
      return this._ended;
    },

    /**
     * Is the frame paused?
     *
     * @public
     * @method   isPaused
     * @accessor
     *
     * @return {Boolean}
     */
    isPaused: function () {
      return this._paused;
    },

    /**
     * Returns a representation of this frame that is suitable for json serialization.
     *
     * @public
     * @method toJSON
     *
     * @return {Object}
     */
    toJSON: function () {
      return {
        name: this._name,
        begins_at: this._beginsAt,
        ends_at: this.endsAt,
        tick_interval: this.tickInterval,
        sync_ticks: this.syncTicks,
        related_time: this.relatedTime,
        data: this._data
      };
    }
  });

  exports.KairosFrame = KairosFrame;

}(
  'object' === typeof exports && exports || this, // exports
  this._ || this.require && require('underscore') // _
));

/* global _: false */
(function(exports, _, KairosFrame) {

  var
    root = this,
    logChannelFactory = function (channel) {
      // Have to do some fancy shit here since all the console methods are native,
      // you can't use apply on them in all browsers and you can't alias them in
      // all browsers.
      return function (text, args) {
        if (root.console && console[channel]) { // Allow late binding, e.g. Firebug
          args = [].splice.call(arguments, 1);
          if (0 === args.length) { // Handle the simple use-case first, to avoid the possibility of an error, and the associated overhead
            console[channel](text);
          } else {
            try { // This part is in a try-catch since in several browsers, you're not allowed to use apply on a native method
              console[channel].apply(null, [].splice.call(arguments, 0));
            } catch (e) { // In those cases, just dump the args
              console[channel](text, args);
            }
          }
        }
      };
    },

    DURATION_MULTIPLIERS = [
      1000 * 60 * 60 * 24 * 365,
      1000 * 60 * 60 * 24 * 30,
      1000 * 60 * 60 * 24,
      1000 * 60 * 60,
      1000 * 60,
      1000
    ],
    DURATION_PARSER = new RegExp(
      '^' +
        '\\s*P?\\s*' +
        '(?:' +
          '(\\d+)' + // {Years}
          'Y' +
        ')?' +
        '\\s*' +
        '(?:' +
          '(\\d+)' + // {Months}
          'M' +
        ')?' +
        '\\s*' +
        '(?:' +
          '(\\d+)' + // {Days}
          'D' +
        ')?' +
        '\\s*T?\\s*' +
        '(?:' +
          '(\\d+)' + // {Hours}
          'H' +
        ')?' +
        '\\s*' +
        '(?:' +
          '(\\d+)' + // {Minutes}
          'M' +
        ')?' +
        '\\s*' +
        '(?:' +
          '(\\d+)' + // {Seconds}
          'S' +
        ')?' +
      '$',
      'i'
    );

  /**
   * Converts an LDML style duration to milliseconds
   *
   * @private
   * @method  millisecondsFromDuration
   *
   * @param   {String} duration  LDML style duration string
   *
   * @return  {Number}
   */
  function millisecondsFromDuration (duration) {
    return _.reduce(
      _.map(
        duration.match(DURATION_PARSER).splice(1),
        function (n, i) {
          return (parseInt(n, 10) * DURATION_MULTIPLIERS[i]) || 0;
        }
      ),
      function (sum, n) {
        return sum + n;
      },
      0);
  }

  /**
   * Normalizes a timestamp to a number of milliseconds, from either a named
   * time, a date object, or a number (noop)
   *
   * @private
   * @method  normalizeTimestamp
   *
   * @param {Object} obj    Parent of the field
   * @param {String} field  Name of the field
   * @param {Object} times  Set of named times
   */
  function normalizeTimestamp (obj, field, times) {
    if (obj[field]) {
      if (_.isString(obj[field])) {
        obj[field] = times[obj[field]];
      } else if (_.isDate(obj[field])) {
        obj[field] = obj[field].getTime();
      }
    }
  }

  /**
   * Normalizes a begin/end object to be a timestamp.
   * 
   * @private
   * @method  normalizeBeginEnd
   * 
   * @param  {Number|Object}  obj                 Begin/End object
   * @param  {Number|String}  [obj.at]            Begin/End at a specific time, e.g. 0 or "teatime" or 1234567890
   * @param  {Number|String}  [obj.starting]      Offset by an LDML duration or a number of milliseconds, e.g. "5M" or 1000
   * @param  {Number|String}  [obj.after]         Begin/End {offset} after this time, e.g. "teatime" or 1234567890
   * @param  {Number|String}  [obj.before]        Begin/End {offset} before this time, e.g. "teatime" or 1234567890
   * @param  {Number|String}  [obj.interpolated]  Begin/End at a percent {between} this time {and} another time, e.g. 0.5 or "50%"
   * @param  {Number|String}  [obj.between]       Begin/End {at}% between this time {and} another time, e.g. "teatime" or 1234567890
   * @param  {Number|String}  [obj.and]           Begin/End {at}% {between} this time and another time, e.g. "teatime" or 1234567890
   * @param  {Object}         times               Named times
   * @param  {Number}         defaultValue        Default value
   * 
   * @return {Number}
   */
  function normalizeBeginEnd (obj, times, defaultValue) {
    var returnValue = defaultValue;

    if (_.isNumber(obj)) {
      returnValue = obj;
    } else {

      normalizeTimestamp(obj, 'at', times);
      normalizeTimestamp(obj, 'after', times);
      normalizeTimestamp(obj, 'before', times);
      normalizeTimestamp(obj, 'between', times);
      normalizeTimestamp(obj, 'and', times);

      /*
       begin.interpolated is a percent, in either decimal form, or string form.
       We want to normalize this to decimal form.
       */
      if (_.isString(obj.interpolated)) {
        obj.interpolated = parseFloat(obj.interpolated) / 100;
      }

      /*
       begin.starting is a duration, in either millisecond form, or LDML string
       form. We want to normalize this to millisecond form.
       */
      if (_.isString(obj.starting)) {
        obj.starting = millisecondsFromDuration(obj.starting);
      }

      /* The simplest scenario: starts the frame at a specific time */
      if (_.isNumber(obj.at)) {

        returnValue = obj.at;

        /* Starts the frame at an offset before or after a specific time */
      } else if (_.isNumber(obj.starting)) {
        if (_.isNumber(obj.before)) {

          returnValue = obj.before - obj.starting;

        } else if(_.isNumber(obj.after)) {

          returnValue = obj.after  + obj.starting;

        }

        /*
         In this scenario, the frame will begin at a moment that is interpolated
         between two specific times.
         */
      } else if (
        _.isNumber(obj.interpolated) &&
          _.isNumber(obj.between) &&
          _.isNumber(obj.and)) {

        returnValue = obj.between + (obj.and - obj.between) * obj.interpolated;

      }
    }

    return returnValue;
  }

  /**
   * Normalizes a set of times and frames. In each frame, begin/end and relatedTo
   * will be normalized as unix timestamps.
   *
   * @private
   * @method  normalizeFrames
   *
   * @param  {Object}          options                              Options hash
   * @param  {Object}          options.times                        Key/value pair of named times, and timestamps or data attributes containing a timestamp
   * @param  {Object[]}        options.frames                       Set of frames
   * @param  {Number|String}   options.frames.relatedTo             Time to count towards/from
   * @param  {Number}          [options.frames.interval]            Interval between renders
   * @param  {String}          [options.frames.frameName]           If this frame is named, we'll fire a special pubsub event when we reach it
   * @param  {Boolean|Number}  [options.frames.sync=true]           Should we ensure that we render exactly on the (second/minute/hour/day) ?
   * @param  {Object}          options.frames.begin                 When does a frame begin?
   * @param  {Object}          options.frames.end                   When does a frame end?
   */
  function normalizeFrames (options) {
    _.each(options.times, function (time, name) {
      if (_.isDate(time)) {
        options.times[name] = time.getTime();
      }
    });

    _.each(options.frames, function (frame) {
      _.defaults(frame, {
        sync: true,
        begin: {},
        end: {}
      });

      normalizeTimestamp(frame, 'relatedTo', options.times);

      /*
       interval is a duration, in either millisecond form, or LDML string form.
       We want to normalize this to millisecond form.
       */
      if (_.isString(frame.interval)) {
        frame.interval = millisecondsFromDuration(frame.interval);
      }

      frame.begin = normalizeBeginEnd(frame.begin, options.times, 0);
    });

    _.each(options.frames, function (frame, i) {
      var
        nextFrame = options.frames[i + 1],
        defaultEndTime = nextFrame ? nextFrame.begin : Infinity;

      if (defaultEndTime < frame.begin) {
        defaultEndTime = Infinity;
      }

      frame.end = normalizeBeginEnd(frame.end, options.times, defaultEndTime);
    });
  }

  /**
   * Creates a new KairosScheduler
   *
   * @public
   * @constructor
   *
   * @param  {Object}          options                              Options hash
   * @param  {Object}          options.times                        Key/value pair of named times, and timestamps or data attributes containing a timestamp
   * @param  {Object[]}        options.frames                       Set of frames
   * @param  {Number|String}   options.frames.relatedTo             Time to count towards/from
   * @param  {Number}          [options.frames.interval]            Interval between renders
   * @param  {String}          [options.frames.frameName]           If this frame is named, we'll fire a special pubsub event when we reach it
   * @param  {Boolean|Number}  [options.frames.sync=true]           Should we ensure that we render exactly on the (second/minute/hour/day) ?
   * @param  {Object}          options.frames.begin                 When does a frame begin?
   * @param  {Number|String}   [options.frames.begin.at]            Begin at a specific time, e.g. 0 or "teatime" or 1234567890
   * @param  {Number|String}   [options.frames.begin.starting]      Offset by an LDML duration or a number of milliseconds, e.g. "5M" or 1000
   * @param  {Number|String}   [options.frames.begin.after]         Begin {offset} after this time, e.g. "teatime" or 1234567890
   * @param  {Number|String}   [options.frames.begin.before]        Begin {offset} before this time, e.g. "teatime" or 1234567890
   * @param  {Number|String}   [options.frames.begin.interpolated]  Begin at a percent {between} this time {and} another time, e.g. 0.5 or "50%"
   * @param  {Number|String}   [options.frames.begin.between]       Begin {at}% between this time {and} another time, e.g. "teatime" or 1234567890
   * @param  {Number|String}   [options.frames.begin.and]           Begin {at}% {between} this time and another time, e.g. "teatime" or 1234567890
   */
  function KairosScheduler (options) {
    options = _.extend({
      times: {},
      frames: [],
      autoStart: true
    }, options);

    var self = this;

    normalizeFrames(options);
    this._options = options;

    this._frames = _.map(options.frames, function (frame) {
      return new KairosFrame(self, frame);
    });

    this.logger.info('Kairos Scheduler created with options', JSON.stringify(options));

    //renderLoop.call(this);
    if (options.autoStart) {
      this.start();
    }
  }

  _.extend(KairosScheduler.prototype, {

    /**
     * Start (or schedule to be started) all frames
     *
     * @public
     * @method start
     */
    start: function () {
      _.invoke(this._frames, 'start');
    },

    /**
     * Pauses all frames. While paused, frames will not tick, but start/end will
     * still be published.
     *
     * @public
     * @method pause
     */
    pause: function () {
      _.invoke(this._frames, 'pause');
    },

    /**
     * Resumes paused frames.
     *
     * @public
     * @method resume
     */
    resume: function () {
      _.invoke(this._frames, 'resume');
    },

    /**
     * Publishes an event on a given channel.
     *
     * @public
     * @method publish
     *
     * @param {String} channel         A channel on which to publish
     * @param {Mixed}  [args]          An array of arguments to be passed to the subscribers, or a single argument
     * @param {Object} [scope=window]  Scope in which to execute the subscribers (defaults to window)
     */
    publish: function (channel, args, scope) {
      var self = this;

      if (self._notifyChannels && self._notifyChannels[channel]) {
        if (!_.isArray(args)) {
          args = [args];
        }

        _.each(self._notifyChannels[channel], function (fn) {
          try {
            fn.apply(scope, args);
          } catch (e) {
            self.logger.error(e);
          }
        });
      }
    },

    /**
     * Subscribes a function to a given channel.
     *
     * @public
     * @method subscribe
     *
     * @param  {String}   channel  A channel on which to listen
     * @param  {Function} fn       A function to be called when the subscribed event publishes
     */
    subscribe: function (channel, fn) {
      if (!this._notifyChannels) {
        this._notifyChannels = {};
      }
      if (!this._notifyChannels[channel]) {
        this._notifyChannels[channel] = [];
      }
      this._notifyChannels[channel].push(fn);
    },

    logger: {
      log:   logChannelFactory('log'),
      info:  logChannelFactory('info'),
      debug: logChannelFactory('debug'),
      warn:  logChannelFactory('warn'),
      error: logChannelFactory('error')
    }
  });

  exports.KairosScheduler = KairosScheduler;

}(
  'object' === typeof exports && exports || this,
  this._ || this.require && require('underscore'),
  this.KairosFrame || 'object' === typeof exports && exports.KairosFrame
));
